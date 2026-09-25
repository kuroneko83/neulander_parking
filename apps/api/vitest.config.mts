import { defineConfig } from "vitest/config";

/**
 * Unit tests only — no external dependencies (Postgres/Redis). Runs as part of
 * the root `pnpm test` (Turbo `test` task). Integration tests (Supertest against
 * a real Nest app, requiring infra/docker/compose.yml up) live in `test/` and run
 * via `pnpm test:int` (see vitest.config.int.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    // `test/unit/**`: testes de unidade que não pertencem a `src/` porque não testam código
    // de produção, e sim tooling do workspace (ex.: `test/unit/eslint-boundaries.test.ts`,
    // que roda o ESLint sobre a config de fronteiras de módulo).
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
  },
});
