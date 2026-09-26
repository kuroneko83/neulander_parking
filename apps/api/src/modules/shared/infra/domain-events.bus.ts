import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "@neulander/contracts";

/**
 * Deliberately typed against `@neulander/contracts`'s `DomainEvent` (the wire envelope: `id`,
 * `type`, `version`, `occurredAt`, `aggregateId`, `organizationId`, `payload`), NOT
 * `modules/shared/domain/domain-event.ts`'s local extension of it — that extension adds
 * `aggregateType`, which exists only for `outbox_events.aggregate_type` bookkeeping
 * (`OutboxService`) and is never part of what a consumer actually receives off `job.data`
 * (see that file's own doc comment). A handler registered here gets exactly the envelope
 * `DomainEventsProcessor.process()` validates with `DomainEventSchema.parse()` — nothing more.
 */

/** A consumer's handler for one event type — async, returns nothing; any thrown error
 * propagates up through `DomainEventsProcessor.process()` and fails the BullMQ job (which
 * then retries per `OutboxRelayProcessor`'s `attempts`/backoff, ADR-0017 §7). */
export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

/**
 * In-process registry: event type → handler(s) (ADR-0017 §2). `DomainEventsProcessor` is
 * the ONLY consumer of the `domain-events` BullMQ queue (ADR-0017 §1 — the reason this
 * registry exists at all: a second `@Processor` on the same queue would steal jobs from the
 * first instead of both receiving every event); this bus is what lets multiple modules
 * (`notifications`, and later `occupancy`/`facilities`/`reporting`) each react to the same
 * event type without competing for the same BullMQ job.
 *
 * Each consuming module registers its own handler(s) — typically from its `events/*
 * .handler.ts`'s own `onModuleInit()` (ADR-0017 §2: "cada módulo registra seus handlers no
 * onModuleInit do próprio handler ou do seu `*.module.ts`") — by injecting this class (it's
 * a normal singleton provider, exported by `modules/shared`'s `index.ts`) and calling
 * `register()`.
 *
 * An event type with no registered handler is NOT an error (ADR-0017 §3): most event types
 * have no consumer yet at any given point in this project's roadmap (see
 * `docs/architecture/api-and-events.md`'s event table — most rows list a FUTURE module as
 * consumer), so `dispatch()` just logs at `debug` and acks the job.
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlersByType = new Map<string, DomainEventHandler[]>();

  register(eventType: string, handler: DomainEventHandler): void {
    const handlers = this.handlersByType.get(eventType) ?? [];
    handlers.push(handler);
    this.handlersByType.set(eventType, handlers);
  }

  /**
   * Runs every handler registered for `event.type`, in registration order, sequentially
   * (not `Promise.all` — a slow/failing handler for one consumer shouldn't race a
   * side-effecting handler for another; ADR-0017 accepts a slow handler delaying the whole
   * queue as the trade-off for this prototype's volume, see its "Consequências" section).
   * Never logs `event` itself (ADR-0017 §"Consequências": a payload can carry a secret,
   * e.g. `identity.member_invited.v1`'s accept token) — only `event.id`/`event.type`.
   */
  async dispatch(event: DomainEvent): Promise<void> {
    const handlers = this.handlersByType.get(event.type);

    if (!handlers || handlers.length === 0) {
      this.logger.debug(`Nenhum handler registrado para o evento "${event.type}" (id ${event.id}).`);
      return;
    }

    for (const handler of handlers) {
      await handler(event);
    }
  }
}
