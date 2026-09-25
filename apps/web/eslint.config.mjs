// @ts-check
import { createConfig } from "@neulander/config/eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * React layer on top of the shared flat config (ADR-0002, CLAUDE.md persona
 * `web-engineer`): hooks-correctness rules (`eslint-plugin-react-hooks`) and
 * accessibility rules (`eslint-plugin-jsx-a11y`) — the persona requires managed
 * focus, labelled inputs and status never conveyed by color alone.
 */
export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  jsxA11y.flatConfigs.recommended,
  {
    files: ["src/**/*.tsx", "src/**/*.ts"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];
