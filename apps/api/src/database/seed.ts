/**
 * `db:seed` runner (ULTRAPLAN 0.4). Standalone script — loads the monorepo-root `.env`
 * itself, connects to Postgres, then hands off to `runSeed`.
 *
 * Scope, deliberately minimal: no domain module exists yet (`organizations`, `users`,
 * `parking_lots`, ... start at ULTRAPLAN 1.2+), so there is nothing to seed today. This
 * only proves the plumbing (connect, run, disconnect, correct exit code) so each future
 * module can add its own seed step to `runSeed` incrementally without re-wiring the
 * script. The eventual target (see docs/architecture/data-model.md and the
 * database-engineer persona) is one organization, a few parking lots in São Paulo with
 * zones/spots/rate plans, and one user per role — built up module by module, not in one
 * shot here.
 *
 * Usage: `pnpm --filter api db:seed` (from the repo root, or `pnpm db:seed` from inside
 * `apps/api`).
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadRootEnvFile } from "../config/load-root-env-file";
import { CONNECTION_TIMEOUT_MS } from "./connection-config";

loadRootEnvFile();

/**
 * Runs every registered seed step against `db`. Empty today on purpose — see the file
 * header. Each future module wires its own step in here once its tables exist, e.g.:
 *
 *   await seedIdentity(db);   // ULTRAPLAN 1.2+
 *   await seedFacilities(db); // ULTRAPLAN 2.1+
 */
function runSeed(_db: NodePgDatabase): Promise<void> {
  console.log("[db:seed] Nenhuma tabela para semear ainda — ver docs/ULTRAPLAN.md (1.2+).");
  return Promise.resolve();
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL não definido. Copie .env.example para .env na raiz do monorepo.",
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  pool.on("error", (error: Error) => {
    console.error(`[db:seed] Erro em conexão ociosa do pool: ${error.message}`);
  });
  const db = drizzle(pool);

  try {
    await runSeed(db);
    console.log("[db:seed] Concluído com sucesso.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:seed] Falha ao semear o banco:", error);
  process.exit(1);
});
