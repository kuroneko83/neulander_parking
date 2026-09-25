import { describe, expect, it } from "vitest";

import { notImplementedYet, PricingEngineNotImplementedError } from "./index";

describe("notImplementedYet", () => {
  it("throws PricingEngineNotImplementedError naming the missing feature", () => {
    expect(() => notImplementedYet("calculateFare")).toThrow(PricingEngineNotImplementedError);
    expect(() => notImplementedYet("calculateFare")).toThrow(/calculateFare/);
  });

  it("sets a stable error name for callers that branch on it instead of instanceof", () => {
    try {
      notImplementedYet("dailyCap");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as Error).name).toBe("PricingEngineNotImplementedError");
    }
  });

  it("keeps instanceof working (prototype chain survives compilation target)", () => {
    try {
      notImplementedYet("overnightRate");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(PricingEngineNotImplementedError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
