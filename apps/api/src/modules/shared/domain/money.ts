import { DomainError } from "./domain-error";

/**
 * Brand for `Cents` (ULTRAPLAN 0.5, CLAUDE.md rule 4: "Dinheiro em centavos (integer),
 * nunca float"). A plain `number` alias would let any `number` (e.g. `19.9`, a float
 * amount someone typed by mistake) flow into a signature expecting money — the brand
 * makes that a compile-time error: the only way to get a `Cents` is through `toCents()`,
 * which validates the value first.
 */
declare const CentsBrand: unique symbol;
export type Cents = number & { readonly [CentsBrand]: true };

/**
 * Validates and brands a raw number as `Cents`. Rejects anything that isn't a finite
 * integer (floats, `NaN`, `Infinity`) — the one gate that keeps float amounts out of the
 * codebase at the boundary (parsing a request body, reading a DB row, a pricing engine
 * result) instead of trusting every call site to remember not to pass a float.
 */
export function toCents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new DomainError(
      "INVALID_CENTS",
      `Valor em centavos precisa ser um inteiro, recebido: ${String(value)}`,
    );
  }
  return value as Cents;
}

/** Type guard version of `toCents` for call sites that want to branch instead of catch. */
export function isCents(value: number): value is Cents {
  return Number.isInteger(value);
}

export const ZERO_CENTS: Cents = toCents(0);

export function addCents(a: Cents, b: Cents): Cents {
  return toCents(a + b);
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return toCents(a - b);
}
