import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Component tests (Vitest + React Testing Library + MSW, jsdom environment —
 * system-design.md §10). Separate from vite.config.ts, mirroring apps/api's
 * split between vitest.config.mts (unit) and vitest.config.int.mts (integration):
 * here the split is dev/build config vs. test config instead.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
