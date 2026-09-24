// @ts-check
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config for every workspace in the monorepo (ADR-0002).
 *
 * Type-aware rules only apply to `src/**\/*.ts(x)` — that's the one glob every
 * workspace's own tsconfig.json is expected to `include`. Root-level tooling
 * scripts (this file, `*.config.ts`, etc.) get syntax-only linting so they don't
 * need to be added to a tsconfig for the parser's project service to find them.
 *
 * Each workspace calls this with its own directory so type-aware rules resolve
 * against that workspace's own tsconfig, e.g.:
 *
 *   // apps/api/eslint.config.js
 *   import { createConfig } from "@neulander/config/eslint";
 *   export default createConfig({ tsconfigRootDir: import.meta.dirname });
 *
 * @param {{ tsconfigRootDir: string }} options
 */
export function createConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: ["dist/**", "coverage/**", "node_modules/**", ".turbo/**"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      plugins: {
        "simple-import-sort": importSort,
      },
      rules: {
        // CLAUDE.md: sem `any` (use `unknown` + narrowing). Regra sintática — não
        // depende de type info, então também vale para os arquivos de config abaixo.
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "separate-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        // Import order deterministic e sem depender de resolver de paths do monorepo.
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
      },
    },
    {
      // Código de aplicação/biblioteca: lint type-aware completo.
      files: ["src/**/*.ts", "src/**/*.tsx"],
      extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
    },
    // Precisa vir por último: desliga regras estilísticas que conflitam com o Prettier.
    prettierConfig,
  );
}

export default createConfig({ tsconfigRootDir: import.meta.dirname });
