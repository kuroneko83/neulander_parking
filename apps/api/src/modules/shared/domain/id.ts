import { v7 as uuidv7 } from "uuid";

/**
 * Generates a UUID v7 (RFC 9562) — time-ordered, so IDs used as a table's `id uuid`
 * primary key sort naturally by insertion time (data-model.md convention: "PK id uuid
 * (UUID v7, gerado na aplicação → ordenável por tempo)"). Every future domain module
 * generates its entities' `id` with this function instead of `crypto.randomUUID()`
 * (v4, unordered) or rolling its own.
 *
 * Also the source of `DomainEvent.id` (see `domain-event.ts`), which doubles as the
 * BullMQ `jobId` in `OutboxRelayProcessor` — BullMQ's native per-`jobId` dedupe is what
 * gives handlers "idempotent by id" delivery (ADR-0007), so that id has to be a UUID
 * generated once, here, at event-creation time — never re-derived later.
 *
 * Library choice: `uuid` — the de facto standard package for the Node ecosystem
 * (actively maintained, hundreds of millions of weekly downloads), which added a native,
 * spec-compliant `v7()` export. Picked over a smaller dedicated `uuidv7` package
 * specifically to avoid depending on a second, less-maintained UUID library for one
 * function when the one already a near-universal transitive dependency already covers it.
 */
export function newId(): string {
  return uuidv7();
}
