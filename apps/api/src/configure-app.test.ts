import { afterEach, describe, expect, it } from "vitest";

import { assertRateLimitMultiplierIsSafeForProduction } from "./configure-app";
// Same reasoning as `configure-app.ts`'s own import — the pure config file, not
// `modules/shared`'s barrel, which would eagerly validate `process.env` (no `.env` loaded
// in this pure unit test).
import { DECORATOR_TIME_MULTIPLIER } from "./modules/shared/infra/rate-limit.config";

/** This whole suite runs under Vitest, so `process.env.VITEST` is already set to `"true"` by
 * the time these tests run (Vitest sets it itself, on every worker process, before any
 * module loads) — every test below stubs it explicitly instead of relying on that ambient
 * value, so the suite's own behavior doesn't silently depend on running under Vitest to pass.
 * Restored to whatever it was before each test, never left mutated for a later file. */
describe("assertRateLimitMultiplierIsSafeForProduction (round-4 security-review fix, MEDIUM — VITEST-based check)", () => {
  const originalVitestEnv = process.env["VITEST"];

  afterEach(() => {
    if (originalVitestEnv === undefined) {
      delete process.env["VITEST"];
    } else {
      process.env["VITEST"] = originalVitestEnv;
    }
  });

  it("never throws while running under Vitest (VITEST env var set), regardless of the multiplier", () => {
    process.env["VITEST"] = "true";

    expect(() => {
      assertRateLimitMultiplierIsSafeForProduction();
    }).not.toThrow();
  });

  it(`throws when DECORATOR_TIME_MULTIPLIER isn't 1 and VITEST isn't set — the real danger case this guard exists for (e.g. a deployed task definition with NODE_ENV=test, run via \`node dist/main.js\`, no VITEST env var present), which the round-2 version of this guard (keyed off AppConfigService.isProduction) could never actually catch — DECORATOR_TIME_MULTIPLIER is ${String(DECORATOR_TIME_MULTIPLIER)}x here since this whole suite runs under NODE_ENV=test`, () => {
    // Sanity check on the premise: if this ever becomes 1 (e.g. NODE_ENV stops being "test"
    // for some future reason), the assertion below would trivially pass for the wrong
    // reason — fail loudly here instead of silently no-oping.
    expect(DECORATOR_TIME_MULTIPLIER).not.toBe(1);

    delete process.env["VITEST"];

    expect(() => {
      assertRateLimitMultiplierIsSafeForProduction();
    }).toThrow(/rate limit/i);
  });
});
