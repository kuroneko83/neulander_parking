import { defineConfig } from "tsup";

/**
 * Dual CJS + ESM build (ULTRAPLAN 0.6) — unlike `@neulander/config` (ESM-only, only ever
 * consumed for build-time tooling), `@neulander/contracts` is imported at RUNTIME by
 * `apps/api`, which compiles to CommonJS (see `apps/api/tsconfig.json`'s comment on why).
 * A CommonJS `require()` cannot load an ESM-only package synchronously, so this package
 * must ship both a `require`-able CJS build and an `import`-able ESM build (see the
 * `exports` map in `package.json`) — the same will apply to `apps/web`/`apps/mobile`
 * (ESM/bundler) and `@neulander/pricing`, which mirrors this config for the same reason.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});
