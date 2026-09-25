// @ts-check
import { createConfig } from "@neulander/config/eslint";

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
];
