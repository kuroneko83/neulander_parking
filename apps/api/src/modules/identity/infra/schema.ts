/**
 * Drizzle schema for the `identity` module's own tables (ULTRAPLAN 1.2, data-model.md
 * "identity" section, lines ~46-52): `users`, `organizations`, `memberships`,
 * `refresh_tokens`. Re-exported by the top-level `apps/api/src/database/schema.ts` barrel,
 * same pattern as `modules/shared/infra/schema.ts`.
 *
 * No use cases exist yet (`domain/`/`application/` are still empty — that's ULTRAPLAN
 * 1.3/1.4): this file only defines the tables and their invariants (unique/CHECK/FK), all
 * enforced by Postgres itself and proven by `apps/api/test/identity/schema.int.test.ts`.
 */
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `citext` (case-insensitive text, enabled by migration 0000 — ADR-0003) has no native
 * Drizzle column type as of drizzle-orm 0.45 (checked: `drizzle-orm/pg-core` ships `text`,
 * `varchar`, etc. but nothing for `citext`), hence this `customType`. `data`/`driverData`
 * are both plain `string` — citext behaves exactly like `text` on the wire, Postgres just
 * folds case for comparisons/uniqueness server-side, so no `toDriver`/`fromDriver` mapping
 * is needed, only `dataType()` naming the Postgres type for migrations.
 */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

/**
 * `users` (data-model.md `identity` table, row 1). `email` is `citext` (not `text`) so
 * `unique(email)` and future login lookups are case-insensitive at the database level
 * (`Foo@Bar.com` and `foo@bar.com` collide) instead of relying on every call site
 * normalizing case itself.
 *
 * `role_global` is nullable text + CHECK (data-model.md convention: "Enums como text +
 * CHECK") rather than `CREATE TYPE` — easier to extend later without a type-alter
 * migration. Values mirror `GlobalRoleSchema` in `packages/contracts/src/identity.ts`
 * exactly (`driver` | `platform_admin`); most users (owners/managers/operators) have this
 * column `null` — a global role is the exception, not the rule (see that schema's own
 * comment on `MeSchema.roleGlobal`).
 *
 * `cpf_encrypted` is nullable `text`: this task only defines the column (per data-model.md)
 * — the encryption itself is out of scope here (no flow collects it yet; `RegisterInput`
 * deliberately excludes CPF, see `packages/contracts/src/identity.ts`). Named `_encrypted`
 * in the schema itself as a standing reminder that whatever writes this column later must
 * encrypt before insert (CLAUDE.md rule 10, LGPD), never store a raw CPF here.
 *
 * `deleted_at` is a soft-delete marker (data-model.md lists it, unlike most tables which
 * only get `archived_at` "onde há exigência") — no code reads/writes it yet in this task.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    cpfEncrypted: text("cpf_encrypted"),
    roleGlobal: text("role_global"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    check("users_role_global_check", sql`${table.roleGlobal} IN ('driver', 'platform_admin')`),
  ],
);

/**
 * `organizations` (data-model.md `identity` table, row 2) — the tenant. `status` defaults
 * to `active`: an organization is usable the moment it's created (no draft/approval step
 * documented anywhere for this prototype's scope — CLAUDE.md's 2026-09-25 decision note).
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    legalName: text("legal_name").notNull(),
    cnpj: text("cnpj").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("organizations_cnpj_unique").on(table.cnpj),
    check("organizations_status_check", sql`${table.status} IN ('active', 'suspended')`),
  ],
);

/**
 * `memberships` (data-model.md `identity` table, row 3) — join row between `users` and
 * `organizations`, scoped by `role`. `role` values mirror `OrganizationRoleSchema` in
 * `packages/contracts/src/identity.ts` exactly (`owner` | `manager` | `operator`), and
 * unlike `users.role_global` this column is always required — a membership without a role
 * makes no sense (see that schema's own comment on why the two enums are kept separate).
 *
 * `parking_lot_ids` — "escopo do operador; vazio = todos" (data-model.md): an empty array
 * is the default and means unrestricted access to every lot in the organization, not "no
 * lots" (mirrors `MembershipSchema.parkingLotIds` in the same contracts file). No FK to
 * `parking_lots` here — that table doesn't exist yet (`facilities` module, Phase 2), and
 * even once it does, cross-module FKs on array elements aren't representable in Postgres
 * anyway; membership scoping validity against real lots is an application-level concern
 * for whichever module owns both facts.
 *
 * `unique(organization_id, user_id)`: a user holds at most one role per organization (to
 * change role, update the row — not add a second membership).
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    parkingLotIds: uuid("parking_lot_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("memberships_organization_id_user_id_unique").on(table.organizationId, table.userId),
    check("memberships_role_check", sql`${table.role} IN ('owner', 'manager', 'operator')`),
  ],
);

/**
 * `refresh_tokens` (data-model.md `identity` table, row 4; ADR-0004 "refresh token opaco
 * ... armazenado como hash, rotacionado a cada uso, com family_id para detectar reuso e
 * revogar a família"). This task only creates the table — issuing/rotating/revoking tokens
 * is ULTRAPLAN 1.3.
 *
 * `token_hash` (never the raw token) is what gets stored and looked up — `unique` doubles
 * as the lookup index for "does this presented token hash exist/is it still valid".
 * `family_id` is a plain `uuid` (not a PK/FK to another table) — it's a shared tag across
 * every token descended from one original login, not a row of its own; ADR-0004's reuse
 * detection revokes every `refresh_tokens` row sharing a `family_id`, which is a query,
 * not a join.
 *
 * `replaced_by` is a nullable self-reference (`id` of the token that replaced this one when
 * it was rotated) — a real FK to this same table's `id`, using Drizzle's documented
 * self-reference pattern (`.references((): AnyPgColumn => refreshTokens.id)`; the explicit
 * `AnyPgColumn` return type breaks the circular type inference that referencing `refreshTokens`
 * from inside its own definition would otherwise create).
 *
 * `index(user_id)`: ADR-0004/1.4's "list a user's active sessions"/"revoke all of a user's
 * refresh tokens" queries filter by `user_id` — data-model.md lists this index explicitly.
 *
 * `index(family_id)` (ULTRAPLAN 1.3 security review, added after this table's original
 * migration — CLAUDE.md: never edit an applied migration, so this lands as its own new one):
 * `RefreshTokensRepository.revokeFamily` filters on `family_id` and is the exact query that
 * runs on the unauthenticated reuse-detection path (`POST /v1/auth/refresh` presented with
 * an already-rotated token) — without an index that's a sequential scan over a table that
 * only ever grows (one row per login/refresh, no purge job yet).
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => refreshTokens.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("refresh_tokens_token_hash_unique").on(table.tokenHash),
    index("refresh_tokens_user_id_idx").on(table.userId),
    index("refresh_tokens_family_id_idx").on(table.familyId),
  ],
);
