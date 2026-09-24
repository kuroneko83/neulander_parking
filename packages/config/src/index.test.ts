import { describe, expect, it } from "vitest";

import { assertNever } from "./index";

describe("assertNever", () => {
  it("throws with the unexpected value in the error message", () => {
    // Cast is intentional: simulates an exhaustiveness check reached with a value the
    // type checker had already ruled out — the exact situation this helper guards against.
    const unexpectedStatus = "unexpected-status" as never;

    expect(() => assertNever(unexpectedStatus)).toThrow(/unexpected-status/);
  });

  it("includes the optional context label in the error message", () => {
    const unexpectedStatus = "unexpected-status" as never;

    expect(() => assertNever(unexpectedStatus, "ParkingSession.transition")).toThrow(
      /ParkingSession\.transition/,
    );
  });
});
