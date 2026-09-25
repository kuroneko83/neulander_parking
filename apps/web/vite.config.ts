import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * ULTRAPLAN 0.7 — apps/web (Vite + React 18 + MUI v5).
 *
 * `envDir` points at the monorepo root: the project's convention so far is a
 * single `.env`/`.env.example` at the repo root covering every app (see
 * CLAUDE.md, apps/api's `loadRootEnvFile()`), not one `.env` per workspace.
 * Only variables prefixed `VITE_` are exposed to client code either way.
 */
export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: {
    port: 5173,
  },
});
