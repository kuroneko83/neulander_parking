/**
 * Integration test for `seedIdentity` (ULTRAPLAN 1.2's `db:seed` step) against the real
 * Postgres from `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres
 *
 * Runs the real `seedIdentity(db)` — the exact function `apps/api/src/database/seed.ts`
 * calls, imported through the module's public barrel (`modules/identity`), not
 * reimplemented here — twice in a row and asserts:
 *
 *  1. Row counts in `users`/`organizations`/`memberships` after the SECOND run equal the
 *     counts after the FIRST run (the idempotency guarantee the task requires: "rode
 *     runSeed/o script duas vezes... confirme que a contagem de linhas em cada tabela não
 *     dobra na segunda vez").
 *  2. The specific demo rows the task asks for exist with the right shape: 1
 *     `platform_admin` with no membership, 1 organization ("Estacionamento Demo"), one
 *     `owner`/`manager`/`operator` membership each (3 distinct users), 1 `driver` with no
 *     membership.
 *  3. `DEMO_SEED_PASSWORD` (documented in README.md) actually verifies against the stored
 *     `password_hash` with `argon2.verify` — proving the seed wrote a real, usable argon2id
 *     hash and not a placeholder string.
 *
 * Deliberately does NOT delete the seeded rows in `afterAll`: they ARE the intended demo
 * dataset (`pnpm db:seed`'s whole point), not test-only fixtures — same rows a developer
 * running `db:seed` against this same database ends up with. Safe to run repeatedly against
 * a long-lived dev database, same repeatability contract as
 * `test/database-migrate.int.test.ts`.
 */
import * as argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO_ORGANIZATION_CNPJ,
  DEMO_SEED_EMAILS,
  DEMO_SEED_PASSWORD,
  seedIdentity,
} from "../../src/modules/identity";
import { memberships, organizations, users } from "../../src/modules/identity/infra/schema";

/**
 * Row counts scoped to exactly the rows `seedIdentity` owns (the 5 known demo emails / 1
 * known demo cnpj, and memberships for that org) — NOT a whole-table `count(*)`. A
 * whole-table count would be wrong the moment anything else touches these tables between
 * the two snapshots: another integration test file's fixtures (this suite's own
 * `schema.int.test.ts` inserts/deletes `users`/`organizations`/`memberships` rows with
 * unrelated ids), or simply a developer's other data already in a shared dev database.
 * Scoping by this seed step's own known keys makes the idempotency assertion true
 * regardless of what else is happening in the same tables.
 */
async function seedRowCounts(db: NodePgDatabase) {
  const [userRows, organizationRows] = await Promise.all([
    db.select({ id: users.id }).from(users).where(inArray(users.email, DEMO_SEED_EMAILS)),
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.cnpj, DEMO_ORGANIZATION_CNPJ)),
  ]);
  const organizationId = organizationRows[0]?.id;
  const membershipRows = organizationId
    ? await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.organizationId, organizationId))
    : [];
  return {
    users: userRows.length,
    organizations: organizationRows.length,
    memberships: membershipRows.length,
  };
}

describe("seedIdentity — idempotent against real Postgres", () => {
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error("DATABASE_URL não definido — carregado via test/setup-int.ts.");
    }
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool);

    // Ensure at least one run already happened before this test's own baseline count, so
    // "running it again doesn't duplicate" is actually exercised regardless of test order /
    // whether a developer already ran `db:seed` by hand against this same database.
    await seedIdentity(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("running it again does not change row counts in users/organizations/memberships", async () => {
    const before = await seedRowCounts(db);
    expect(before).toEqual({ users: 5, organizations: 1, memberships: 3 });

    await seedIdentity(db);

    const after = await seedRowCounts(db);

    expect(after).toEqual(before);
  });

  it("seeds exactly one platform_admin with no membership", async () => {
    const [admin] = await db.select().from(users).where(eq(users.email, "admin@neulander.dev"));

    expect(admin?.roleGlobal).toBe("platform_admin");

    const adminMemberships = admin
      ? await db.select().from(memberships).where(eq(memberships.userId, admin.id))
      : [];
    expect(adminMemberships).toEqual([]);
  });

  it("seeds exactly one driver with no membership", async () => {
    const [driver] = await db.select().from(users).where(eq(users.email, "motorista@neulander.dev"));

    expect(driver?.roleGlobal).toBe("driver");

    const driverMemberships = driver
      ? await db.select().from(memberships).where(eq(memberships.userId, driver.id))
      : [];
    expect(driverMemberships).toEqual([]);
  });

  it("seeds the demo organization with one owner/manager/operator membership, three distinct users", async () => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, "Estacionamento Demo"));
    expect(org).toBeDefined();

    const orgMemberships = org
      ? await db.select().from(memberships).where(eq(memberships.organizationId, org.id))
      : [];

    const roles = orgMemberships.map((m) => m.role).sort();
    expect(roles).toEqual(["manager", "operator", "owner"]);

    // Three distinct users — no one user holds more than one of these roles.
    const userIds = new Set(orgMemberships.map((m) => m.userId));
    expect(userIds.size).toBe(3);
  });

  it("DEMO_SEED_PASSWORD verifies against the stored password_hash (real argon2id, not a placeholder)", async () => {
    const [admin] = await db.select().from(users).where(eq(users.email, "admin@neulander.dev"));
    expect(admin?.passwordHash).toBeDefined();

    await expect(argon2.verify(admin!.passwordHash, DEMO_SEED_PASSWORD)).resolves.toBe(true);
    await expect(argon2.verify(admin!.passwordHash, "wrong-password")).resolves.toBe(false);
  });
});
