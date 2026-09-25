import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { addCents, CentsSchema, isCents, subtractCents, toCents, ZERO_CENTS } from "./money";

describe("toCents", () => {
  it("brands a valid integer as Cents", () => {
    expect(toCents(1200)).toBe(1200);
    expect(toCents(0)).toBe(0);
    expect(toCents(-500)).toBe(-500);
  });

  it.each([19.9, 0.1, NaN, Infinity, -Infinity])(
    "rejects non-integer value %s by throwing a ZodError",
    (value) => {
      expect(() => toCents(value)).toThrow(ZodError);
    },
  );

  it("rejects non-integer values with an issue on the root path", () => {
    try {
      toCents(19.9);
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues[0]?.path).toEqual([]);
    }
  });
});

describe("CentsSchema", () => {
  it("parses valid integers directly", () => {
    expect(CentsSchema.parse(1200)).toBe(1200);
  });

  it("safeParse reports failure for invalid input without throwing", () => {
    const result = CentsSchema.safeParse(19.9);
    expect(result.success).toBe(false);
  });
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

  it("re-validates the result for a normal addition well within range", () => {
    // addCents/subtractCents always produce integers from integer inputs, but the
    // re-validation through toCents() is what guarantees that stays true even if a
    // future refactor changes the arithmetic — this pins that behavior down.
    expect(() => addCents(toCents(1_000_000), toCents(2_000_000))).not.toThrow();
  });

  it("re-validates the result and rejects an overflow past Number.MAX_SAFE_INTEGER", () => {
    // Zod's `.int()` enforces the safe-integer range (stricter than the original
    // apps/api implementation, which only checked `Number.isInteger` and would have let
    // this particular value — still exactly representable as a double — through). A
    // `Cents` amount beyond MAX_SAFE_INTEGER can't be trusted to add up correctly, so the
    // stricter behavior is intentional, not a regression.
    expect(() => addCents(toCents(Number.MAX_SAFE_INTEGER), toCents(1))).toThrow(ZodError);
  });
});
