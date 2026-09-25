import { InjectQueue } from "@nestjs/bullmq";
import type { OnModuleDestroy } from "@nestjs/common";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { asc, eq, isNull } from "drizzle-orm";

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
        await this.queue.add(row.type, row.payload, { jobId: row.id });
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
}
