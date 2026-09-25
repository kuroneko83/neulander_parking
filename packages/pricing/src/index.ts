/**
 * `@neulander/pricing` — motor de tarifação (funções puras, 100% testado per CLAUDE.md's
 * Stack table). Intentionally EMPTY of business logic as of ULTRAPLAN 0.6: the real rate
 * engine (parsing `rate_plan_versions.rules`/`RatePlanRules`, computing `amount_due_cents`
 * for a `ParkingSession`, etc.) is ULTRAPLAN 3.1.
 *
 * `notImplementedYet()` below exists so this package has at least one real, exported,
 * tested unit — proving the tsup dual CJS+ESM build, Vitest, ESLint and `tsc --noEmit`
 * pipelines all work end-to-end for `@neulander/pricing` (and that `apps/api` can already
 * depend on it, workspace-wired, before any real pricing code exists) instead of shipping a
 * package with nothing to build, lint or test.
 */

/**
 * Thrown by `notImplementedYet()`. Named so a stack trace from an over-eager caller of a
 * not-yet-built pricing feature reads clearly instead of a generic "x is not a function".
 */
export class PricingEngineNotImplementedError extends Error {
  constructor(feature: string) {
    super(`@neulander/pricing: "${feature}" ainda não implementado (ver ULTRAPLAN 3.1).`);
    this.name = "PricingEngineNotImplementedError";
    // Keeps `instanceof PricingEngineNotImplementedError` working when compiled down under
    // CommonJS (same concern as apps/api's DomainError — see its comment for why).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Placeholder entry point for the pricing engine. Any future call site that reaches this
 * before ULTRAPLAN 3.1 lands gets a clear, typed error naming the missing feature instead of
 * silently doing nothing or crashing with an unrelated `TypeError`.
 */
export function notImplementedYet(feature: string): never {
  throw new PricingEngineNotImplementedError(feature);
}
