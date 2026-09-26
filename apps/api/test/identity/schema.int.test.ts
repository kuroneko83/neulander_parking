/**
 * Integration test for the `identity` module's tables (ULTRAPLAN 1.2) against the real
 * Postgres from `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres
 *
 * Proves the invariants `docs/architecture/data-model.md`'s `identity` section documents
 * are actually enforced by Postgres — not just declared in `infra/schema.ts` — by inserting
 * a valid row, then trying to violate each constraint and asserting Postgres itself rejects
 * it (SQLSTATE `23505` unique_violation / `23514` check_violation), same style as
 * `test/database-migrate.int.test.ts` asserting against real state instead of "it didn't
 * throw".
 *
 * Uses a bare `pg.Pool` + `drizzle(pool)` (no schema generic, no Nest) rather than booting
 * `AppModule` — this test only needs to prove constraints at the SQL level, not any
 * application wiring (unlike `test/shared/outbox.int.test.ts`, which specifically tests
 * Nest-wired services). Every inserted row is deleted in `afterEach`/`afterAll` so this file
 * can run repeatedly against the same long-lived dev database without leaving residue
 * behind for `test/identity/seed.int.test.ts`'s row-count assertions.
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  memberships,
  organizations,
  refreshTokens,
  users,
} from "../../src/modules/identity/infra/schema";
import { newId } from "../../src/modules/shared";

/** Postgres SQLSTATE codes this file asserts against (see the `pg` docs / the
 * `postgres error codes` appendix) — asserted instead of just "rejects", so a passing test
 * actually proves *which* constraint fired, not merely that something went wrong. Matched
 * as `{ cause: { code } }`, not `{ code }`: drizzle-orm wraps the raw `pg` `DatabaseError`
 * in its own `DrizzleQueryError`, whose own enumerable properties are `message`/`query`/
 * `params`/`cause` — the real `pg` error (with `.code`) is that `cause`. */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

describe("identity schema — constraints against real Postgres", () => {
  let pool: Pool;
  let db: NodePgDatabase;
  const userIdsToCleanUp: string[] = [];
  const organizationIdsToCleanUp: string[] = [];

  beforeAll(() => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error("DATABASE_URL não definido — carregado via test/setup-int.ts.");
    }
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool);
  });

  afterAll(async () => {
    // Children first (FKs): refresh_tokens/memberships before users/organizations.
    for (const userId of userIdsToCleanUp) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await db.delete(memberships).where(eq(memberships.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    for (const organizationId of organizationIdsToCleanUp) {
      await db.delete(memberships).where(eq(memberships.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    await pool.end();
  });

  async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
    const id = newId();
    await db.insert(users).values({
      id,
      email: `schema-int-${id}@example.test`,
      passwordHash: "not-a-real-hash",
      name: "Fixture User",
      ...overrides,
    });
    userIdsToCleanUp.push(id);
    return id;
  }

  async function insertOrganization(
    overrides: Partial<typeof organizations.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(organizations).values({
      id,
      name: "Fixture Org",
      legalName: "Fixture Org Ltda.",
      cnpj: `cnpj-${id}`,
      ...overrides,
    });
    organizationIdsToCleanUp.push(id);
    return id;
  }

  describe("users", () => {
    it("unique(email): a second row with the same email is rejected", async () => {
      const email = `dup-${newId()}@example.test`;
      await insertUser({ email });

      await expect(insertUser({ email })).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
    });

    it("email uniqueness is case-insensitive (citext) — differently-cased duplicate is rejected", async () => {
      const email = `citext-${newId()}@example.test`;
      await insertUser({ email });

      await expect(insertUser({ email: email.toUpperCase() })).rejects.toMatchObject({
        cause: { code: UNIQUE_VIOLATION },
      });
    });

    it("CHECK role_global: rejects a value outside ('driver', 'platform_admin')", async () => {
      await expect(insertUser({ roleGlobal: "not-a-real-role" })).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION },
      });
    });

    it("accepts both real role_global values and null (the common case)", async () => {
      await expect(insertUser({ roleGlobal: "driver" })).resolves.toEqual(expect.any(String));
      await expect(insertUser({ roleGlobal: "platform_admin" })).resolves.toEqual(expect.any(String));
      await expect(insertUser()).resolves.toEqual(expect.any(String));
    });
  });

  describe("organizations", () => {
    it("unique(cnpj): a second row with the same cnpj is rejected", async () => {
      const cnpj = `dup-cnpj-${newId()}`;
      await insertOrganization({ cnpj });

      await expect(insertOrganization({ cnpj })).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
    });

    it("CHECK status: rejects a value outside ('active', 'suspended')", async () => {
      await expect(insertOrganization({ status: "not-a-real-status" })).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION },
      });
    });
  });

  describe("memberships", () => {
    it("unique(organization_id, user_id): a second membership for the same pair is rejected", async () => {
      const organizationId = await insertOrganization();
      const userId = await insertUser();

      await db.insert(memberships).values({ id: newId(), organizationId, userId, role: "owner" });

      await expect(
        db.insert(memberships).values({ id: newId(), organizationId, userId, role: "manager" }),
      ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });

      await db.delete(memberships).where(eq(memberships.organizationId, organizationId));
    });

    it("CHECK role: rejects a value outside ('owner', 'manager', 'operator')", async () => {
      const organizationId = await insertOrganization();
      const userId = await insertUser();

      await expect(
        db.insert(memberships).values({
          id: newId(),
          organizationId,
          userId,
          role: "not-a-real-role",
        }),
      ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
    });

    it("parking_lot_ids defaults to an empty array ('vazio = todos', data-model.md)", async () => {
      const organizationId = await insertOrganization();
      const userId = await insertUser();

      await db.insert(memberships).values({ id: newId(), organizationId, userId, role: "operator" });
      const [row] = await db
        .select({ parkingLotIds: memberships.parkingLotIds })
        .from(memberships)
        .where(eq(memberships.userId, userId));

      expect(row?.parkingLotIds).toEqual([]);

      await db.delete(memberships).where(eq(memberships.userId, userId));
    });
  });

  describe("refresh_tokens", () => {
    it("unique(token_hash): a second row with the same token hash is rejected", async () => {
      const userId = await insertUser();
      const tokenHash = `hash-${newId()}`;

      await db.insert(refreshTokens).values({
        id: newId(),
        userId,
        tokenHash,
        familyId: newId(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        db.insert(refreshTokens).values({
          id: newId(),
          userId,
          tokenHash,
          familyId: newId(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
    });

    it("replaced_by self-references another refresh_tokens row", async () => {
      const userId = await insertUser();
      const originalId = newId();
      await db.insert(refreshTokens).values({
        id: originalId,
        userId,
        tokenHash: `hash-${newId()}`,
        familyId: newId(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const replacementId = newId();
      await db.insert(refreshTokens).values({
        id: replacementId,
        userId,
        tokenHash: `hash-${newId()}`,
        familyId: newId(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await db
        .update(refreshTokens)
        .set({ replacedBy: replacementId })
        .where(eq(refreshTokens.id, originalId));

      const [row] = await db
        .select({ replacedBy: refreshTokens.replacedBy })
        .from(refreshTokens)
        .where(eq(refreshTokens.id, originalId));
      expect(row?.replacedBy).toBe(replacementId);
    });
  });
});
