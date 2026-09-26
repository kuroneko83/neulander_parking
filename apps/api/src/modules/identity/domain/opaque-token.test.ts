import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateOpaqueToken, hashOpaqueToken } from "./opaque-token";

describe("generateOpaqueToken", () => {
  it("returns a 64-character hex string (256 bits)", () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token on every call", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();

    expect(a).not.toBe(b);
  });
});

describe("hashOpaqueToken", () => {
  it("is deterministic — the same input always hashes to the same output", () => {
    const token = generateOpaqueToken();

    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("matches a plain SHA-256 hex digest of the input", () => {
    const token = "fixed-value-for-a-known-vector";

    expect(hashOpaqueToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("different inputs hash to different outputs", () => {
    expect(hashOpaqueToken("a")).not.toBe(hashOpaqueToken("b"));
  });
});
