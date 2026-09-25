import { defineConfig } from "tsup";

/**
 * Dual CJS + ESM build (ULTRAPLAN 0.6), same rationale as `@neulander/contracts`'
 * `tsup.config.ts`: this package is empty of business logic for now, but the pricing
 * engine (ULTRAPLAN 3.1) will be imported at RUNTIME by `apps/api` (CommonJS — see
 * `apps/api/tsconfig.json`) and, per `docs/architecture/system-design.md` §7.1, potentially
 * by `apps/mobile` (offline fare estimate) too, which needs an ESM/bundler-friendly build.
 * Set up dual output from the start so nothing has to change the day real logic lands here.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});
