import { defineConfig } from "vitest/config";

/**
 * Integration tests (Supertest + a real Nest application). Some of these
 * (test/health.int.test.ts) require infra/docker/compose.yml running — see the
 * comment at the top of that file. `setupFiles` loads the monorepo-root `.env`
 * so DATABASE_URL/REDIS_URL match the Compose services regardless of the
 * process' current working directory.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Só `*.int.test.ts`: `test/unit/**` também vive aqui (testes de tooling do workspace,
    // que não têm lugar em `src/`) e roda no `pnpm test` normal, não aqui.
    include: ["test/**/*.int.test.ts"],
    setupFiles: ["./test/setup-int.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
