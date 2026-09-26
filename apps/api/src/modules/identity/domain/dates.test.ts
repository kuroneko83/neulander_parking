import { describe, expect, it } from "vitest";

import { addDays } from "./dates";

describe("addDays", () => {
  it("adds whole days to a date", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");

    expect(addDays(start, 30).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("supports zero and negative offsets", () => {
    const start = new Date("2026-01-31T00:00:00.000Z");

    expect(addDays(start, 0).toISOString()).toBe(start.toISOString());
    expect(addDays(start, -30).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not mutate the input date", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const startCopy = new Date(start);

    addDays(start, 5);

    expect(start.toISOString()).toBe(startCopy.toISOString());
  });
});
