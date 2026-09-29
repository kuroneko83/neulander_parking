/**
 * Integration tests for `RedisThrottlerStorage` (ULTRAPLAN 1.6) against the REAL Redis
 * from `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d redis
 *
 * A real connection (not a mock) is used deliberately — the whole point of this adapter is
 * the Lua script's ATOMICITY across concurrent callers sharing one Redis (see the class'
 * own doc comment: this API runs as multiple ECS Fargate tasks behind a load balancer), and
 * that's exactly the kind of behavior a mock can't prove. `parseIncrementReply` (the pure
 * ms→seconds boundary conversion) has its own dependency-free unit test
 * (`src/modules/shared/infra/redis-throttler-storage.test.ts`).
 *
 * Each test uses a brand-new random key (`newId()`) so tests never share Redis state with
 * each other or with any other test file/run — no `FLUSHALL` needed here.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { newId } from "../../src/modules/shared";
import { RedisThrottlerStorage } from "../../src/modules/shared/infra/redis-throttler-storage";

describe("RedisThrottlerStorage (real Redis from compose)", () => {
  let app: INestApplication;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    storage = app.get(RedisThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  it("counts up from 1 and stays unblocked while under the limit", async () => {
    const key = newId();

    const first = await storage.increment(key, 60_000, 3, 60_000, "test");
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });

    const second = await storage.increment(key, 60_000, 3, 60_000, "test");
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false });

    const third = await storage.increment(key, 60_000, 3, 60_000, "test");
    expect(third).toMatchObject({ totalHits: 3, isBlocked: false });
  });

  it("blocks the (limit + 1)th call and reports a positive timeToBlockExpire", async () => {
    const key = newId();
    const limit = 2;

    await storage.increment(key, 60_000, limit, 60_000, "test");
    await storage.increment(key, 60_000, limit, 60_000, "test");
    const overLimit = await storage.increment(key, 60_000, limit, 60_000, "test");

    expect(overLimit.isBlocked).toBe(true);
    expect(overLimit.timeToBlockExpire).toBeGreaterThan(0);
    expect(overLimit.timeToBlockExpire).toBeLessThanOrEqual(60);
  });

  it("keeps returning blocked=true for further calls while still within blockDuration, without the hit counter growing unboundedly", async () => {
    const key = newId();
    const limit = 1;

    await storage.increment(key, 60_000, limit, 60_000, "test");
    const firstBlock = await storage.increment(key, 60_000, limit, 60_000, "test");
    const secondBlock = await storage.increment(key, 60_000, limit, 60_000, "test");
    const thirdBlock = await storage.increment(key, 60_000, limit, 60_000, "test");

    expect(firstBlock.isBlocked).toBe(true);
    expect(secondBlock.isBlocked).toBe(true);
    expect(thirdBlock.isBlocked).toBe(true);
    // The hit counter reported while blocked stays fixed (the script doesn't re-INCR once
    // blocked) — proving a sustained attack doesn't grow the Redis key unboundedly.
    expect(secondBlock.totalHits).toBe(firstBlock.totalHits);
    expect(thirdBlock.totalHits).toBe(firstBlock.totalHits);
  });

  it("two different keys never share state (per-key isolation)", async () => {
    const keyA = newId();
    const keyB = newId();
    const limit = 1;

    await storage.increment(keyA, 60_000, limit, 60_000, "test");
    const aBlocked = await storage.increment(keyA, 60_000, limit, 60_000, "test");
    expect(aBlocked.isBlocked).toBe(true);

    // `keyB` has never been touched — must NOT be blocked just because `keyA` is.
    const bFirst = await storage.increment(keyB, 60_000, limit, 60_000, "test");
    expect(bFirst).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("the SAME key under two different throttlerNames is tracked independently", async () => {
    const key = newId();
    const limit = 1;

    await storage.increment(key, 60_000, limit, 60_000, "strictIp");
    const strictIpBlocked = await storage.increment(key, 60_000, limit, 60_000, "strictIp");
    expect(strictIpBlocked.isBlocked).toBe(true);

    // Different `throttlerName`, same `key` — independent Redis keyspace.
    const moderateIpFirst = await storage.increment(key, 60_000, limit, 60_000, "moderateIp");
    expect(moderateIpFirst).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it("un-blocks again once the block window (a short blockDuration) elapses", async () => {
    const key = newId();
    const limit = 1;
    const shortBlockMs = 1100;

    await storage.increment(key, 500, limit, shortBlockMs, "test");
    const blocked = await storage.increment(key, 500, limit, shortBlockMs, "test");
    expect(blocked.isBlocked).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, shortBlockMs + 200));

    const afterBlockExpired = await storage.increment(key, 500, limit, shortBlockMs, "test");
    expect(afterBlockExpired.isBlocked).toBe(false);
  }, 10_000);
});
