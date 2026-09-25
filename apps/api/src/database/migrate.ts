/**
 * `db:migrate` runner (ULTRAPLAN 0.4). Standalone script — NOT part of Nest's bootstrap —
 * so it loads the monorepo-root `.env` itself before anything reads `process.env`.
 *
 * Applies every migration under `apps/api/drizzle/` with `drizzle-orm`'s own migrator,
 * which tracks what already ran in a `__drizzle_migrations` table it creates/owns in the
 * target database (default schema `drizzle`) — running this twice in a row is a no-op
 * the second time (already-applied migrations are skipped, nothing is re-run or
 * duplicated). Uses a short-lived `Pool` of its own (not `DatabaseModule`'s shared one —
 * this script never boots Nest) and always closes it before exiting.
 *
 * Usage: `pnpm --filter api db:migrate` (from the repo root, or `pnpm db:migrate` from
 * inside `apps/api`).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { loadRootEnvFile } from "../config/load-root-env-file";
import { CONNECTION_TIMEOUT_MS } from "./connection-config";

loadRootEnvFile();

const MIGRATIONS_FOLDER = "./drizzle";

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
  // Same rationale as DatabaseModule: an error on an idle client would otherwise emit an
  // unhandled 'error' event and crash the script with a confusing stack trace.
  pool.on("error", (error: Error) => {
    console.error(`[db:migrate] Erro em conexão ociosa do pool: ${error.message}`);
  });
  const db = drizzle(pool);

  try {
    console.log(`[db:migrate] Aplicando migrations de "${MIGRATIONS_FOLDER}"...`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[db:migrate] Migrations aplicadas com sucesso.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("[db:migrate] Falha ao aplicar migrations:", error);
  process.exit(1);
});
