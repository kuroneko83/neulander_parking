import { InjectQueue } from "@nestjs/bullmq";
import type { OnModuleDestroy } from "@nestjs/common";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import { DATABASE_CONNECTION } from "../../../database/database.module";
import type { Clock } from "../domain/clock";
import { outboxEvents } from "./schema";
import { CLOCK } from "./system-clock";

/**
 * Single BullMQ queue every domain event is published to for now (ULTRAPLAN 0.5
 * decision: "fila única por enquanto" — per-module routing can replace this the day a
 * second real consumer needs it). Job `name` = `event.type`, job `id` = `event.id`,
 * giving native BullMQ dedupe by `jobId` (ADR-0007: "handlers idempotentes por id").
 */
export const DOMAIN_EVENTS_QUEUE = "domain-events";

/** Rows read per relay tick — bounds one polling cycle's work instead of loading the
 * entire backlog in one query if the relay ever falls behind. */
const BATCH_SIZE = 100;

/**
 * Job options for every published event (ADR-0017 §7 — fixed by the first real consumer,
 * `identity.member_invited.v1` → `notifications`): retry with exponential backoff up to 5
 * attempts before a job lands in BullMQ's own `failed` set (the de-facto DLQ for this
 * prototype, no separate queue/alerting yet), then bounded retention on both outcomes so
 * Redis doesn't grow unbounded — a completed job's data is no longer needed once every
 * consumer has (successfully) run, and a failed job is kept a week for manual triage.
 */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * Event payload fields containing secrets that must NOT persist indefinitely in
 * `outbox_events` once published (security-review fix, ULTRAPLAN 1.5): keyed by event
 * `type`, listing which top-level key(s) of the event's OWN payload (i.e.
 * `outbox_events.payload.payload.<field>` — the envelope's nested, event-specific payload,
 * not the envelope's own columns) to strip right after a successful publish. BullMQ/Redis
 * still gets the field for the run that matters (the consumer needs it — e.g.
 * `notifications` building the accept link from `identity.member_invited.v1`'s `token`);
 * only the durable Postgres copy is scrubbed, since nothing ever purges/rotates
 * `outbox_events` rows and unlike Redis (already bounded by `JOB_OPTIONS`'
 * `removeOnComplete`/`removeOnFail` above) it's read by anyone with DB/backup/replica
 * access indefinitely.
 *
 * A denylist keyed by event type, not a generic "detect anything secret-shaped" mechanism
 * — extend this map the day a second event type needs it (ADR-0017 §"Consequências"
 * already flags this as a recurring concern, not unique to this one event), don't build
 * more scrubbing machinery than one map + one call site until there's a second real case.
 */
const SECRET_PAYLOAD_FIELDS_BY_EVENT_TYPE: Readonly<Record<string, readonly string[]>> = {
  "identity.member_invited.v1": ["token"],
};

/** Default poll interval (docs/architecture/api-and-events.md line 149: `outbox-relay`
 * runs "contínuo (poll 500 ms / LISTEN-NOTIFY)" — this picks the plain-polling option;
 * LISTEN/NOTIFY is a possible later optimization, not required for correctness). */
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Publishes pending `outbox_events` rows to BullMQ (ADR-0007). Reads Postgres, then
 * writes Redis, as two separate steps outside any DB transaction — CLAUDE.md rule 7
 * ("nunca chamar serviço externo dentro de uma transação de banco") applies to Redis too.
 * At-least-once delivery is the accepted trade-off: a crash between `queue.add()` and
 * marking `published_at` re-publishes the same event on the next tick, deduped by
 * BullMQ's native `jobId` handling.
 *
 * **Ordering simplification, formally deferred by ADR-0016:** rows are read from Postgres
 * in `occurred_at` order and handed to `queue.add()` in that same order, but nothing
 * enforces per-aggregate ordering *inside* BullMQ once jobs are enqueued — there are no
 * consumers yet to require it. ADR-0007's "ordem por agregado preservada" guarantee is
 * revisited by ADR-0016 (e.g. grouping by `aggregate_id` with per-group concurrency 1, the
 * way `lpr-match` already plans to do per parking lot) the day a real consumer needs
 * strict per-aggregate order.
 *
 * **Only ever runs in the worker process** (ULTRAPLAN 0.5 decision: `AppModule` is
 * shared by both `main.ts` and `main.worker.ts` — this class deliberately does NOT start
 * its own polling from `OnModuleInit`, which would run it in the HTTP process too.
 * `main.worker.ts` is the only caller of `start()`, invoked once after bootstrap
 * completes; the HTTP API only ever writes to the outbox via `OutboxService`.
 */
@Injectable()
export class OutboxRelayProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @InjectQueue(DOMAIN_EVENTS_QUEUE) private readonly queue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Starts the polling loop. Idempotent — calling it more than once (defensive, should
   * never happen with a single call site) keeps exactly one interval running instead of
   * stacking more.
   */
  start(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS): void {
    if (this.timer) {
      return;
    }
    this.logger.log(`Outbox relay iniciado (poll a cada ${String(pollIntervalMs)}ms).`);
    this.timer = setInterval(() => {
      this.pollOnce().catch((error: unknown) => {
        this.logger.error(error, "Erro ao processar o outbox");
      });
    }, pollIntervalMs);
  }

  /** Stops the polling loop. Safe to call even if `start()` was never called. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Runs exactly one poll cycle: reads up to `BATCH_SIZE` unpublished rows (oldest
   * `occurred_at` first), publishes each to BullMQ, then marks it published. Exposed
   * separately from `start()` so integration tests (and, in principle, an
   * ops/admin "flush now" action later) can trigger a single pass deterministically
   * instead of racing a real timer.
   *
   * Skips overlapping runs (`ticking` guard): if a tick ever takes longer than the poll
   * interval, a second concurrent tick reading/publishing the same not-yet-marked rows
   * would just mean duplicate (BullMQ-deduped) `queue.add()` calls — there's no
   * correctness reason to allow it, only wasted work.
   *
   * Returns the number of rows published in this pass (0 when there was nothing pending,
   * or when a tick was already in flight).
   */
  async pollOnce(): Promise<number> {
    if (this.ticking) {
      return 0;
    }
    this.ticking = true;
    try {
      const pending = await this.db
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.occurredAt))
        .limit(BATCH_SIZE);

      for (const row of pending) {
        await this.queue.add(row.type, row.payload, { jobId: row.id, ...JOB_OPTIONS });

        // Scrubbed BEFORE marking published (post-review fix — see
        // `scrubSecretPayloadFields`'s own doc comment): both this call and the
        // `queue.add()` above are safe to repeat if the process crashes between them and a
        // later tick re-selects this same still-`published_at IS NULL` row — `queue.add()`
        // is a no-op for an already-existing `jobId` (BullMQ dedupe, ADR-0007), and the
        // jsonb `#-` scrub is a no-op once the field is already gone. Marking `published_at`
        // LAST means "this row is fully done" only becomes true once nothing about it can
        // still fail/retry.
        const secretFields = SECRET_PAYLOAD_FIELDS_BY_EVENT_TYPE[row.type];
        if (secretFields) {
          await this.scrubSecretPayloadFields(row.id, secretFields);
        }

        await this.db
          .update(outboxEvents)
          .set({ publishedAt: this.clock.now() })
          .where(eq(outboxEvents.id, row.id));
      }

      return pending.length;
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Removes `payload.<field>` (the event's own payload, nested under the envelope's
   * `payload` column — see `SECRET_PAYLOAD_FIELDS_BY_EVENT_TYPE`'s doc comment) from the
   * stored row via Postgres' jsonb `#-` (delete-at-path) operator.
   *
   * Runs BEFORE `published_at` is set (`pollOnce()`'s call site — corrected in review; an
   * earlier version ran this AFTER marking published and claimed the residual risk was
   * "at worst one more relay tick", which was wrong: once `published_at IS NOT NULL` the
   * row is permanently excluded from `pollOnce()`'s own `isNull(publishedAt)` query, so a
   * crash between marking published and scrubbing would have left the secret in Postgres
   * FOREVER, not just briefly). With the corrected order, a crash at any point before
   * `published_at` is set just means the row gets reprocessed on a later tick — both
   * `queue.add()` above (BullMQ's native `jobId` dedupe, ADR-0007) and this scrub (a jsonb
   * `#-` on an already-missing key is a no-op) are safe to repeat, so the row only ever
   * becomes "done" (published_at set) once both have durably succeeded at least once.
   *
   * Non-obvious consequence worth flagging for future debugging: a manual outbox replay
   * (re-publishing an already-published, therefore already-scrubbed, row by hand) will fail
   * Zod parsing at the consumer for any event type in `SECRET_PAYLOAD_FIELDS_BY_EVENT_TYPE`
   * — `MemberInvitedPayloadSchema.token` (`packages/contracts/src/identity.ts`) is a
   * *required* field, and it's gone from the stored row by design. This is expected, not a
   * bug: a scrubbed secret is not something this system can ever "replay" again by
   * definition — a new invitation (and a new token) is the only way to give someone a
   * working accept link after the original one's event row has been scrubbed.
   *
   * `field` only ever comes from this file's own hardcoded
   * `SECRET_PAYLOAD_FIELDS_BY_EVENT_TYPE` map (never row/request data), so building the
   * jsonb path literal with `sql.raw` here carries no injection risk.
   */
  private async scrubSecretPayloadFields(eventId: string, fields: readonly string[]): Promise<void> {
    for (const field of fields) {
      await this.db
        .update(outboxEvents)
        .set({ payload: sql`${outboxEvents.payload} #- ${sql.raw(`'{payload,${field}}'::text[]`)}` })
        .where(eq(outboxEvents.id, eventId));
    }
  }
}
