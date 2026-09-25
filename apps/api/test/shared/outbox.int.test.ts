/**
 * Integration test for the transactional outbox (ADR-0007, ULTRAPLAN 0.5 acceptance
 * criterion: "integração do outbox (evento gravado na tx e publicado)") — against the
 * real Postgres + Redis from `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 *
 * Boots the real `AppModule` (same DI graph the app uses) so `OutboxService` and
 * `OutboxRelayProcessor` are wired exactly as in production, then:
 *
 *  1. Opens a real Drizzle transaction, writes a trivial "business" row (an
 *     `idempotency_keys` row stands in for a domain write — no domain module exists yet)
 *     and calls `OutboxService.record()` with a domain event, in the SAME transaction,
 *     and commits.
 *  2. Calls `OutboxRelayProcessor.pollOnce()` directly (one pass, no timer/worker
 *     entrypoint needed) and asserts:
 *       (a) the event shows up in the real BullMQ queue, looked up by `jobId` — proving
 *           `event.id` was used as both the outbox PK and the BullMQ job id (dedupe).
 *       (b) `outbox_events.published_at` is filled in Postgres.
 *  3. Separately asserts the atomicity half of the outbox pattern: a transaction that
 *     writes to the outbox and then throws before committing leaves NO row behind
 *     (rollback undoes the outbox write exactly like any other write in the same tx).
 */
import { getQueueToken } from "@nestjs/bullmq";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import type { Database } from "../../src/database/database.module";
import { DATABASE_CONNECTION } from "../../src/database/database.module";
import type { DomainEvent } from "../../src/modules/shared";
import { DOMAIN_EVENTS_QUEUE, newId, OutboxRelayProcessor, OutboxService } from "../../src/modules/shared";
import { idempotencyKeys, outboxEvents } from "../../src/modules/shared/infra/schema";

function buildEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: newId(),
    type: "shared.test_thing_happened.v1",
    version: 1,
    occurredAt: new Date(),
    aggregateType: "TestThing",
    aggregateId: newId(),
    organizationId: newId(),
    payload: { note: "outbox.int.test.ts fixture" },
    ...overrides,
  };
}

describe("Transactional outbox -> BullMQ relay (real Postgres + Redis from compose)", () => {
  let app: INestApplication;
  let db: Database;
  let outboxService: OutboxService;
  let outboxRelay: OutboxRelayProcessor;
  let queue: Queue;
  const eventIdsToCleanUp: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(DATABASE_CONNECTION);
    outboxService = app.get(OutboxService);
    outboxRelay = app.get(OutboxRelayProcessor);
    queue = app.get<Queue>(getQueueToken(DOMAIN_EVENTS_QUEUE));
  });

  afterAll(async () => {
    for (const id of eventIdsToCleanUp) {
      await db.delete(outboxEvents).where(eq(outboxEvents.id, id));
      const job = await queue.getJob(id);
      await job?.remove();
    }
    await app.close();
  });

  it("records the event in the same transaction as a business write, then the relay publishes it and marks it published", async () => {
    const event = buildEvent();
    eventIdsToCleanUp.push(event.id);

    // Step 1: same-transaction write (ADR-0007) — a trivial business row (standing in
    // for a real domain write, none exist yet) plus the outbox record, committed together.
    await db.transaction(async (tx) => {
      await tx.insert(idempotencyKeys).values({
        key: event.id, // reusing the event id as a convenient unique value for this fixture
        scope: "test:outbox-int",
        requestHash: "fixture-hash",
        responseStatus: 200,
        responseBody: { ok: true },
        expiresAt: new Date(Date.now() + 60_000),
      });
      await outboxService.record(tx, event);
    });

    // Sanity check: committed, and not published yet (the relay hasn't run).
    const [beforeRelay] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    expect(beforeRelay).toBeDefined();
    expect(beforeRelay?.publishedAt).toBeNull();

    // Step 2: run exactly one relay pass — no timer, no worker entrypoint.
    const published = await outboxRelay.pollOnce();
    expect(published).toBeGreaterThan(0);

    // (a) the event is a real job in the real BullMQ queue, addressable by jobId.
    const job = await queue.getJob(event.id);
    expect(job).toBeDefined();
    expect(job?.name).toBe(event.type);
    expect(job?.data).toMatchObject({
      id: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
      organizationId: event.organizationId,
      payload: event.payload,
    });

    // (b) outbox_events.published_at is filled in Postgres.
    const [afterRelay] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    expect(afterRelay?.publishedAt).not.toBeNull();

    // Clean up the stand-in idempotency row (not tracked by eventIdsToCleanUp).
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, event.id));
  });

  it("running the relay again is a no-op for an already-published event (BullMQ jobId dedupe)", async () => {
    const event = buildEvent();
    eventIdsToCleanUp.push(event.id);

    await db.transaction(async (tx) => {
      await outboxService.record(tx, event);
    });

    await outboxRelay.pollOnce();
    const firstJob = await queue.getJob(event.id);
    expect(firstJob).toBeDefined();

    // A published row is excluded from the next poll's query (published_at IS NOT NULL) —
    // this proves the "give me pending rows" query, not just the queue's own dedupe.
    const publishedAgain = await outboxRelay.pollOnce();
    expect(publishedAgain).toBe(0);
  });

  it("rolls back the outbox write with the rest of the transaction when it throws before committing", async () => {
    const event = buildEvent();

    await expect(
      db.transaction(async (tx) => {
        await outboxService.record(tx, event);
        throw new Error("forcing a rollback to prove atomicity");
      }),
    ).rejects.toThrow("forcing a rollback");

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    expect(row).toBeUndefined();

    const job = await queue.getJob(event.id);
    expect(job).toBeUndefined();
  });
});
