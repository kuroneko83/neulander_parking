/**
 * Drizzle schema for the `shared` kernel's own tables (ULTRAPLAN 0.5, data-model.md
 * "shared / plataforma" section): `outbox_events` (ADR-0007) and `idempotency_keys`
 * (docs/architecture/api-and-events.md line 10). Re-exported by the top-level
 * `apps/api/src/database/schema.ts` barrel, same as every other module's
 * `infra/schema.ts` will be from Phase 1 onward.
 */
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `outbox_events` — one row per domain event, written in the same transaction as the use
 * case that raised it (ADR-0007). `payload` stores the **entire** wire envelope (id, type,
 * version, occurredAt, aggregateId, organizationId, payload — see `domain/domain-event.ts`
 * and docs/architecture/api-and-events.md line 124) as a single JSON blob: `id`/
 * `aggregate_type`/`aggregate_id`/`type`/`occurred_at` are duplicated as their own columns
 * only for indexing/ordering (`OutboxRelayProcessor` reads pending rows ordered by
 * `occurred_at`); the relay publishes `payload` verbatim as the BullMQ job data, so it
 * never has to reassemble the envelope from separate columns.
 *
 * Partial index on `published_at IS NULL` (data-model.md): the relay's only query is
 * "give me pending rows", and once a row is published it never needs this index again —
 * a full index over every row (most of which end up published) would just be dead weight.
 *
 * `id`/`aggregate_id` are native Postgres `uuid` columns, not `text` (data-model.md
 * convention: "PK id uuid, UUID v7, gerado na aplicação") — both are always a
 * `newId()`-generated UUID v7 string (`domain/id.ts`), so the stricter column type is free
 * validation and a smaller on-disk/index footprint than `text`.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_events_published_at_idx")
      .on(table.publishedAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

/**
 * `idempotency_keys` — `IdempotencyInterceptor` reads/writes this. `scope` disambiguates
 * *which* client namespace generated `key` (an `Idempotency-Key` header is only unique
 * within its own caller's namespace, not globally) — see the interceptor for how `scope`
 * is resolved today (no auth yet, Phase 1/5). Deliberately **not** a `CHECK`-constrained
 * enum like other documented enums (data-model.md's "Enums como text + CHECK" convention):
 * the set of valid scope *values* is still evolving pre-auth (today it's the caller's IP
 * or an explicit `request.idempotencyScope`; Phase 1 adds `user:<id>`, Phase 5 adds
 * `device:<id>`) — constraining it now would need a migration the day auth lands, for a
 * constraint that buys nothing (the interceptor is the only writer of this table).
 *
 * No `created_at`/`updated_at` — data-model.md doesn't list them for this table, and
 * unlike a domain entity this is a short-lived cache row (`expires_at`, TTL 24h per the
 * "Particionamento e retenção" section) with no history worth keeping.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })],
);
