/**
 * Integration test for `RedisThrottlerStorage`'s FAIL-OPEN policy (ULTRAPLAN 1.6
 * security-review fix, blocking #3) when Redis itself is unreachable — mirrors
 * `test/health.int.test.ts`'s own "(dependency unreachable)" describe block: points
 * `AppConfigService.redisUrl` at a host/port nothing listens on instead of tearing down the
 * real `infra/docker/compose.yml` Redis, then boots the REAL `AppModule` against it.
 *
 * This is the one thing `test/shared/redis-throttler-storage.int.test.ts` (happy-path, real
 * Redis) can't exercise: that a genuinely unreachable Redis makes `increment()` resolve
 * FAST with a never-blocking, zero-hit record — see `RedisThrottlerStorage`'s own doc
 * comment for the full fail-open rationale (an outage degrading brute-force protection is a
 * far smaller, temporary risk than an outage locking every real user out of auth entirely).
 */
import type { INestApplication } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../../src/app.module";
import { AppConfigService } from "../../src/config/app-config.service";
import { newId } from "../../src/modules/shared";
import { OUTAGE_WARN_INTERVAL_MS, RedisThrottlerStorage } from "../../src/modules/shared/infra/redis-throttler-storage";

// Same partial override `test/health.int.test.ts` uses for its own "(dependency
// unreachable)" suite — see that file for why each field is required (every eagerly-
// constructed provider in the REAL `AppModule` reads its own slice of `AppConfigService`).
const unreachableAppConfig: Pick<
  AppConfigService,
  | "nodeEnv"
  | "isProduction"
  | "http"
  | "corsOrigins"
  | "logLevel"
  | "databaseUrl"
  | "databasePool"
  | "redisUrl"
  | "smtpUrl"
  | "emailFrom"
  | "webAppUrl"
> = {
  nodeEnv: "test",
  isProduction: false,
  http: { port: 0, host: "127.0.0.1" },
  corsOrigins: ["http://localhost:5173"],
  logLevel: "silent",
  databaseUrl: "postgresql://neulander:neulander@127.0.0.1:1/neulander_parking",
  databasePool: { min: 0, max: 1 },
  redisUrl: "redis://127.0.0.1:1",
  smtpUrl: "smtp://127.0.0.1:1",
  emailFrom: "relatorios@neulander-parking.example.com",
  webAppUrl: "http://localhost:5173",
};

describe("RedisThrottlerStorage (Redis unreachable — fail-open policy)", () => {
  let app: INestApplication;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue(unreachableAppConfig)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    storage = app.get(RedisThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  it("increment() fails OPEN (never blocks, zero hits) and resolves fast instead of hanging", async () => {
    const startedAt = Date.now();

    const record = await storage.increment(newId(), 60_000, 3, 60_000, "test");

    // Well under Vitest's own per-test default timeout (5s) — bounded by
    // `commandTimeout`/`maxRetriesPerRequest: 1`, not left to hang indefinitely.
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(record).toEqual({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
  }, 10_000);

  it("reset() swallows the error instead of throwing (best-effort)", async () => {
    await expect(storage.reset(newId(), "test")).resolves.toBeUndefined();
  }, 10_000);

  it("logs a warn line (observable in logs/alerts) instead of failing silently", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // Round-2 security-review fix (MEDIUM): the outage warn is now sampled at most once per
    // `OUTAGE_WARN_INTERVAL_MS` — a FRESH `RedisThrottlerStorage` instance (not the shared
    // `storage` from `beforeAll`, whose sampling state may already have been touched by an
    // earlier `it()` in this file) guarantees this first call always logs, deterministically,
    // regardless of run order.
    const freshStorage = new RedisThrottlerStorage(unreachableAppConfig as unknown as AppConfigService);

    await freshStorage.increment(newId(), 60_000, 3, 60_000, "test");

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 10_000);

  it("round-2 security-review fix (MEDIUM): samples the outage warn — a burst of failures within the interval logs only once, with a suppressed count noted", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");
    // A fresh instance (see previous test's comment) — deterministic regardless of run order.
    const freshStorage = new RedisThrottlerStorage(unreachableAppConfig as unknown as AppConfigService);

    const baseTime = 1_000_000;
    nowSpy.mockReturnValue(baseTime);
    await freshStorage.increment(newId(), 60_000, 3, 60_000, "test"); // first failure — always logs

    nowSpy.mockReturnValue(baseTime + 100); // well within the sampling interval
    await freshStorage.increment(newId(), 60_000, 3, 60_000, "test"); // suppressed
    await freshStorage.increment(newId(), 60_000, 3, 60_000, "test"); // suppressed

    expect(warnSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(baseTime + OUTAGE_WARN_INTERVAL_MS + 1); // interval elapsed
    await freshStorage.increment(newId(), 60_000, 3, 60_000, "test"); // logs again

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const secondWarnMessage = warnSpy.mock.calls[1]?.[0] as string;
    // Mentions the two suppressed occurrences from the burst above, instead of silently
    // dropping that they happened.
    expect(secondWarnMessage).toContain("2");
    expect(secondWarnMessage.toLowerCase()).toContain("suprimid");

    warnSpy.mockRestore();
    nowSpy.mockRestore();
  }, 10_000);
});
