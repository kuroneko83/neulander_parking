// @ts-check
import { createConfig } from "@neulander/config/eslint";

import boundariesConfig from "./eslint.boundaries.mjs";

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // NestJS modules/entrypoints are legitimately empty classes that exist only to
    // carry a `@Module()`/`@Injectable()`/... decorator (AppModule, LoggingModule,
    // AppConfigModule, HealthModule, ...) — that's the framework's idiom, not dead code.
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
  // Fronteiras de módulo (CLAUDE.md regras 1 e 2), automatizadas — ULTRAPLAN 0.8. Só aqui,
  // e não no `packages/config` compartilhado: a estrutura `src/modules/<ctx>/<camada>` é da
  // API. Roda no `pnpm lint` normal (`eslint . --max-warnings 0`), sem ferramenta à parte.
  ...boundariesConfig,
];
