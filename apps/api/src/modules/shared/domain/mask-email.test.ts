import { describe, expect, it } from "vitest";

import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first character of the local part visible, masking the rest of it", () => {
    expect(maskEmail("gestor@estacionamento-demo.neulander.dev")).toBe(
      "g*****@estacionamento-demo.neulander.dev",
    );
    expect(maskEmail("a@example.com")).toBe("a@example.com");
  });

  it("keeps the whole domain part visible", () => {
    expect(maskEmail("ana.souza@example.com")).toBe("a********@example.com");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskEmail("  gestor@example.com  ")).toBe("g*****@example.com");
  });

  it("masks the entire string when there's no '@' at all", () => {
    expect(maskEmail("not-an-email")).toBe("*".repeat("not-an-email".length));
  });

  it("masks the entire string when the local part is empty (e.g. \"@example.com\")", () => {
    expect(maskEmail("@example.com")).toBe("*".repeat("@example.com".length));
  });

  it("handles an empty string without throwing", () => {
    expect(maskEmail("")).toBe("");
  });

  it("never throws, and never returns the original value for anything but a 1-character local part", () => {
    expect(() => maskEmail("###garbage###")).not.toThrow();
    expect(maskEmail("ana@example.com")).not.toBe("ana@example.com");
  });
});
