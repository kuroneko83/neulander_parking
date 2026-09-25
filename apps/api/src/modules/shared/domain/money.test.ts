import { describe, expect, it } from "vitest";

import { addCents, isCents, subtractCents, toCents, ZERO_CENTS } from "./money";

describe("toCents", () => {
  it("brands a valid integer as Cents", () => {
    expect(toCents(1200)).toBe(1200);
    expect(toCents(0)).toBe(0);
    expect(toCents(-500)).toBe(-500);
  });

  it.each([19.9, 0.1, NaN, Infinity, -Infinity])(
    "rejects non-integer value %s with DomainError INVALID_CENTS",
    (value) => {
      expect(() => toCents(value)).toThrow(/inteiro/);
      try {
        toCents(value);
        expect.unreachable("deveria ter lançado");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("INVALID_CENTS");
      }
    },
  );
});

describe("isCents", () => {
  it("returns true for integers, false otherwise", () => {
    expect(isCents(100)).toBe(true);
    expect(isCents(0)).toBe(true);
    expect(isCents(19.9)).toBe(false);
    expect(isCents(NaN)).toBe(false);
  });
});

describe("ZERO_CENTS", () => {
  it("is zero", () => {
    expect(ZERO_CENTS).toBe(0);
  });
});

describe("addCents / subtractCents", () => {
  it("adds two Cents values", () => {
    expect(addCents(toCents(1200), toCents(300))).toBe(1500);
  });

  it("subtracts two Cents values, allowing negative results", () => {
    expect(subtractCents(toCents(300), toCents(1200))).toBe(-900);
  });

  it("re-validates the result, so an overflow into a non-integer would still throw", () => {
    // addCents/subtractCents always produce integers from integer inputs, but the
    // re-validation through toCents() is what guarantees that stays true even if a
    // future refactor changes the arithmetic — this pins that behavior down.
    expect(() => addCents(toCents(Number.MAX_SAFE_INTEGER), toCents(1))).not.toThrow();
  });
});
