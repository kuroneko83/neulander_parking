import { defineConfig } from "drizzle-kit";

import { loadRootEnvFile } from "./src/config/load-root-env-file";

// `drizzle-kit` runs as a standalone CLI, outside Nest's bootstrap (main.ts/main.worker.ts
// call `loadRootEnvFile()` themselves) — load the monorepo-root `.env` ourselves so
// DATABASE_URL is populated regardless of the process' current working directory.
loadRootEnvFile();

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL não definido. Copie .env.example para .env na raiz do monorepo (ver README).",
  );
}

/**
 * Drizzle Kit config (ULTRAPLAN 0.4, ADR-0003). `schema` points at the barrel that every
 * domain module re-exports its own `infra/schema.ts` into (see src/database/schema.ts —
 * empty until Phase 1's first module). `out` is the migrations folder this repo commits
 * to git; `drizzle-kit generate` reads/writes its bookkeeping under `out/meta/`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
