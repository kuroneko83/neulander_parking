/**
 * Shared Prettier config for every workspace (ADR-0002).
 * Consume from a workspace's own prettier.config.js:
 *   export { default } from "@neulander/config/prettier";
 *
 * @type {import("prettier").Config}
 */
const config = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  arrowParens: "always",
  endOfLine: "lf",
};

export default config;
