import { describe, expect, it } from "vitest";

import { newId } from "./id";

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newId", () => {
  it("generates a well-formed UUID v7 (version and variant nibbles set)", () => {
    expect(newId()).toMatch(UUID_V7_REGEX);
  });

  it("never repeats across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it("is time-ordered: ids generated later sort after ids generated earlier", () => {
    const first = newId();
    const second = newId();
    expect(first < second).toBe(true);
  });
});
