import { Processor, WorkerHost } from "@nestjs/bullmq";
import { DomainEventSchema } from "@neulander/contracts";
import type { Job } from "bullmq";

import { DomainEventBus } from "./domain-events.bus";
import { DOMAIN_EVENTS_QUEUE } from "./outbox-relay.processor";

/**
 * The single consumer of the `domain-events` BullMQ queue (ADR-0017 §1) — every module that
 * wants to react to a domain event registers a handler with `DomainEventBus` instead of
 * declaring its own `@Processor(DOMAIN_EVENTS_QUEUE)`, which would silently steal jobs from
 * this one (BullMQ delivers each job to exactly one worker on a queue; two `@Processor`s on
 * the same queue name are two competing workers, not two fan-out subscribers).
 *
 * `autorun: false` (ADR-0017 §4, mirrors `OutboxRelayProcessor`'s own reasoning): `AppModule`
 * is shared by both entrypoints (`main.ts`/`main.worker.ts`), so `@nestjs/bullmq`'s explorer
 * still constructs a real `Worker` instance in BOTH processes at bootstrap — but with
 * `autorun: false` that `Worker` never starts pulling jobs from Redis on its own.
 * `main.worker.ts`, and only it, calls `.worker.run()` after bootstrap to actually start
 * consuming. `concurrency: 1` (ADR-0017 §4) keeps processing deterministic for integration
 * tests that drive the relay + this processor manually via `pollOnce()`/a single
 * `process()` call, at the cost of throughput this project's volume doesn't need.
 */
@Processor(DOMAIN_EVENTS_QUEUE, { autorun: false, concurrency: 1 })
export class DomainEventsProcessor extends WorkerHost {
  constructor(private readonly domainEventBus: DomainEventBus) {
    super();
  }

  /**
   * `job.data` is whatever `OutboxRelayProcessor.pollOnce()` passed to `queue.add()` — the
   * envelope as read back from `outbox_events.payload` (a Postgres jsonb column), which
   * means `occurredAt` already went through one JSON round-trip and arrives as an ISO
   * STRING, not a `Date` instance (`OutboxService.record()` serializes it explicitly for
   * exactly this reason). Re-hydrated to a real `Date` here, before
   * `DomainEventSchema.parse()` — which requires `occurredAt: z.date()` — ever sees it,
   * rather than loosening the shared contract's own type for this one caller (ADR-0017 §5:
   * "job.data é parseado com DomainEventSchema... antes de chegar ao handler").
   */
  async process(job: Job): Promise<void> {
    const rawData = job.data as Record<string, unknown>;
    const occurredAt = rawData["occurredAt"];

    const event = DomainEventSchema.parse({
      ...rawData,
      occurredAt: typeof occurredAt === "string" ? new Date(occurredAt) : occurredAt,
    });

    await this.domainEventBus.dispatch(event);
  }
}
