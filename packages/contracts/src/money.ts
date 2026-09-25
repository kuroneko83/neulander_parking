import { z } from "zod";

/**
 * Zod schema for money amounts in cents (CLAUDE.md rule 4: "Dinheiro em centavos
 * (integer), nunca float. Tipo `Cents` de `packages/contracts`"). Branded via Zod's own
 * `.brand()` so the only way to get a `Cents` value past the type checker is through
 * `toCents()`/`CentsSchema.parse()` — a plain `number` alias would let any `number` (e.g.
 * `19.9`, a float amount typed by mistake) flow into a signature expecting money.
 *
 * Migrated here from `apps/api/src/modules/shared/domain/money.ts` (ULTRAPLAN 0.5) as part
 * of ULTRAPLAN 0.6: `Cents` is a wire-level contract every consumer needs (API today,
 * `apps/web`/`apps/mobile` later — see `docs/architecture/data-model.md`'s
 * `*_cents integer` convention), not an API-internal type, so it belongs in
 * `packages/contracts`, the project's single source of truth for shared contracts
 * (CLAUDE.md rule 3).
 *
 * `.int()` rejects anything that isn't `Number.isInteger` — floats, `NaN` and `±Infinity`
 * all fail it, matching the original `apps/api` implementation's validation exactly.
 */
export const CentsSchema = z.number().int().brand<"Cents">();
export type Cents = z.infer<typeof CentsSchema>;

/**
 * Validates and brands a raw number as `Cents`. Throws Zod's `ZodError` for anything that
 * isn't a finite integer.
 *
 * This package stays framework-agnostic (Zod is its only dependency) — it deliberately does
 * NOT throw an API-specific error type (e.g. `apps/api`'s `DomainError`, which would create
 * a wrong-direction dependency from a shared package back onto one consumer). A caller that
 * needs a domain-specific error (mapped to `application/problem+json`, say) should catch the
 * `ZodError` and re-wrap it at its own boundary.
 */
export function toCents(value: number): Cents {
  return CentsSchema.parse(value);
}

/** Type guard version of `toCents` for call sites that want to branch instead of catch. */
export function isCents(value: number): value is Cents {
  return CentsSchema.safeParse(value).success;
}

export const ZERO_CENTS: Cents = toCents(0);

export function addCents(a: Cents, b: Cents): Cents {
  return toCents(a + b);
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return toCents(a - b);
}
