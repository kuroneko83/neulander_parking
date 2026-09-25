import type { DomainEvent as DomainEventEnvelope } from "@neulander/contracts";

/**
 * `apps/api`'s local extension of `@neulander/contracts`'s `DomainEventSchema`/
 * `DomainEvent` (ULTRAPLAN 0.6 — the wire envelope itself, `{ id, type, version,
 * occurredAt, aggregateId, organizationId, payload }`, is now the single source of truth
 * in `packages/contracts`; this file no longer defines that shape, it only adds what's
 * local to this API).
 *
 * `aggregateType` is deliberately NOT part of `@neulander/contracts`'s `DomainEventSchema`
 * (see that schema's doc comment): it's extra bookkeeping only `outbox_events.aggregate_type`
 * (data-model.md) needs to know what kind of aggregate emitted the event — never part of the
 * wire envelope a consumer (BullMQ handler, future webhook) actually receives. It's added
 * here, locally, because only `OutboxService`/`OutboxRelayProcessor` (this module) need it.
 *
 * `TPayload` narrows the envelope's `payload: Record<string, unknown>` for callers that
 * know their own event's shape — `@neulander/contracts` keeps `payload` generic across every
 * possible event type, so the narrowing stays here instead of in the shared contract.
 *
 * Every future domain module (Phase 1+) builds one of these and hands it to
 * `OutboxService.record()` inside its use case's transaction.
 */
export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<DomainEventEnvelope, "payload"> {
  /** Not part of the wire envelope — see the doc comment above. */
  aggregateType: string;
  payload: TPayload;
}
