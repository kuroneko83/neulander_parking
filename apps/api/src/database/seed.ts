/**
 * `db:seed` runner (ULTRAPLAN 0.4, first real step added in 1.2). Standalone script —
 * loads the monorepo-root `.env` itself, connects to Postgres, then hands off to
 * `runSeed`.
 *
 * `runSeed` composes one step per module, each imported through that module's public
 * `index.ts` (never `infra/*` internals — CLAUDE.md rule 1; see the comment on
 * `modules/identity/index.ts` re-exporting `seedIdentity` for exactly this caller). The
 * eventual target (see docs/architecture/data-model.md and the database-engineer persona)
 * is one organization, a few parking lots in São Paulo with zones/spots/rate plans, and one
 * user per role — built up module by module, each adding its own step below as its tables
 * land.
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
 * Runs every registered seed step against `db`, in dependency order. `identity` is first
 * since it's the only module with tables today, but order matters going forward — e.g. a
 * future `seedFacilities(db)` will need the `organizations` row this step creates.
 *
 * `import("../modules/identity")` is a **dynamic** import, deliberately, not the usual
 * static `import { seedIdentity } from "../modules/identity"` at the top of the file:
 * `modules/identity/index.ts` re-exports `IdentityModule` alongside `seedIdentity`, and
 * `identity.module.ts` (transitively, via nothing of its own, but by sharing this barrel
 * file) sits next to code that — like every module barrel — can pull in `modules/shared`,
 * whose `index.ts` exports the real `SharedModule`. `SharedModule` imports
 * `AppConfigModule`, and `AppConfigModule`'s `@Module({ imports: [ConfigModule.forRoot()] })`
 * decorator argument runs `ConfigModule.forRoot()` — which validates `process.env` — the
 * instant that file is `require()`-d, not lazily at DI-resolution time. A static import
 * here would `require()` that whole chain while this file's own top-level statements are
 * still being evaluated top-to-bottom, i.e. *before* `loadRootEnvFile()` on the line above
 * has populated `process.env` — crashing with "DATABASE_URL: expected string, received
 * undefined" despite `.env` existing (verified against the real error before landing this
 * fix). A dynamic `import()` defers that `require()` until `runSeed` actually executes
 * (well after `loadRootEnvFile()` above returned), sidestepping the ordering problem
 * entirely. Every future module's seed step wired in here needs the same treatment.
 *
 *   const { seedIdentity } = await import("../modules/identity");
 *   const { seedFacilities } = await import("../modules/facilities"); // ULTRAPLAN 2.1+
 */
async function runSeed(db: NodePgDatabase): Promise<void> {
  const { seedIdentity } = await import("../modules/identity");
  await seedIdentity(db);
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
