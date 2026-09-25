import { z } from "zod";

/**
 * Domain event envelope (`docs/architecture/api-and-events.md`, "Eventos de domínio"
 * section, ~line 124): `{ id, type, version, occurredAt, aggregateId, organizationId,
 * payload }`. Promoted to a Zod schema in `packages/contracts` as part of ULTRAPLAN 0.6
 * (CLAUDE.md rule 3: "todo payload HTTP/WS/evento nasce como schema Zod em
 * packages/contracts e é reutilizado por API, web e mobile") — it was a plain TS
 * `interface` in `apps/api/src/modules/shared/domain/domain-event.ts` (ULTRAPLAN 0.5),
 * which meant it wasn't actually reusable outside the API.
 *
 * `aggregateType` is deliberately NOT part of this schema: per the interface it replaces,
 * it's extra bookkeeping only the outbox table needs (`outbox_events.aggregate_type`,
 * `docs/architecture/data-model.md`) to know what kind of aggregate emitted the event — it
 * is never part of the wire envelope a consumer (BullMQ handler, future webhook) actually
 * receives. `apps/api`'s `OutboxService`/`OutboxRelayProcessor` extend this type locally
 * with that one extra field — see `apps/api/src/modules/shared/domain/domain-event.ts`.
 */
export const DomainEventSchema = z.object({
  /** UUID v7 — also becomes the BullMQ `jobId`, giving the relay/queue dedupe by event id.
   * `z.uuid()` (no version pinned) accepts v7, unlike a hand-rolled v1-v5-only regex. */
  id: z.uuid(),
  /** e.g. `"sessions.session_started.v1"` — the trailing `.vN` doubles as the version tag. */
  type: z.string().min(1),
  version: z.number().int().positive(),
  occurredAt: z.date(),
  aggregateId: z.uuid(),
  organizationId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;
