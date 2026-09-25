/**
 * Domain event envelope (ULTRAPLAN 0.5, docs/architecture/api-and-events.md line 124):
 * `{ id, type, version, occurredAt, aggregateId, organizationId, payload }`. Pure TS type
 * — every domain module (Phase 1+) builds one of these and hands it to
 * `OutboxService.record()` inside its use case's transaction.
 *
 * `aggregateType` is not part of the wire envelope consumers eventually receive (see
 * `OutboxRelayProcessor` — it publishes the envelope fields only) — it's extra
 * bookkeeping the outbox table itself needs (`outbox_events.aggregate_type`,
 * data-model.md) to know what kind of aggregate emitted the event.
 */
export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  /** UUID v7 — also becomes the BullMQ `jobId`, giving the relay/queue dedupe by event id. */
  id: string;
  /** e.g. `"sessions.session_started.v1"` — the trailing `.vN` doubles as the version tag. */
  type: string;
  version: number;
  occurredAt: Date;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  payload: TPayload;
}
