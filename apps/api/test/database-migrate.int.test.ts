/**
 * Integration test for `db:migrate` (ULTRAPLAN 0.4) against the real Postgres from
 * `infra/docker/compose.yml` — same manual prerequisite as test/health.int.test.ts:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres
 *
 * Calls `drizzle-orm/node-postgres/migrator`'s `migrate()` directly (the same function
 * `src/database/migrate.ts` calls) against `apps/api/drizzle/`, then asserts against the
 * real database rather than trusting "it didn't throw":
 *
 *  - the migration's 4 `CREATE EXTENSION` statements actually installed postgis,
 *    btree_gist, pg_trgm and citext (queries `pg_extension`).
 *  - running the exact same migration set a second time is idempotent: no error, and
 *    Drizzle's own `drizzle.__drizzle_migrations` bookkeeping table still has exactly
 *    one row per `.sql` file under `drizzle/` (it does not re-apply/duplicate an
 *    already-applied migration). Counted dynamically from the folder, not hardcoded —
 *    ULTRAPLAN 0.5 added a second migration file (`modules/shared/infra/schema.ts`), and
 *    every module from Phase 1 onward will add more.
 *
 * Safe to run repeatedly against the same long-lived dev database (no drop/recreate
 * needed between runs) — that repeatability *is* the idempotency guarantee under test.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_FOLDER = resolve(__dirname, "../drizzle");
const EXPECTED_EXTENSIONS = ["btree_gist", "citext", "pg_trgm", "postgis"];
const EXPECTED_MIGRATION_COUNT = readdirSync(MIGRATIONS_FOLDER).filter((file) =>
  file.endsWith(".sql"),
).length;

describe("db:migrate — 0000_enable_postgres_extensions against real Postgres", () => {
  let pool: Pool;

  beforeAll(() => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      throw new Error("DATABASE_URL não definido — carregado via test/setup-int.ts.");
    }
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("installs postgis, btree_gist, pg_trgm and citext", async () => {
    const db = drizzle(pool);

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { rows } = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [EXPECTED_EXTENSIONS],
    );

    expect(rows.map((row) => row.extname)).toEqual(EXPECTED_EXTENSIONS);
  });

  it("is idempotent: running migrate() again does not fail or duplicate the migration record", async () => {
    const db = drizzle(pool);

    // First application (in case this test file runs in isolation) + a second one back
    // to back — both must succeed without throwing.
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle."__drizzle_migrations"',
    );

    expect(rows[0]?.count).toBe(String(EXPECTED_MIGRATION_COUNT));

    // Extensions are still exactly the 4 expected ones — a duplicate re-run would not
    // add duplicates (CREATE EXTENSION IF NOT EXISTS), but this pins the invariant down.
    const extensions = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [EXPECTED_EXTENSIONS],
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual(EXPECTED_EXTENSIONS);
  });
});
