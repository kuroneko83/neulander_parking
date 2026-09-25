import { describe, expect, it } from "vitest";

import { FakeClock } from "./clock";

describe("FakeClock", () => {
  it("starts at the given instant (or a fixed default)", () => {
    const clock = new FakeClock(new Date("2026-05-01T10:00:00.000Z"));
    expect(clock.now()).toEqual(new Date("2026-05-01T10:00:00.000Z"));
  });

  it("does not advance on its own between now() calls", () => {
    const clock = new FakeClock(new Date("2026-05-01T10:00:00.000Z"));
    expect(clock.now()).toEqual(clock.now());
  });

  it("advance() moves the clock forward by the given milliseconds", () => {
    const clock = new FakeClock(new Date("2026-05-01T10:00:00.000Z"));
    clock.advance(60_000);
    expect(clock.now()).toEqual(new Date("2026-05-01T10:01:00.000Z"));
  });

  it("advance() accepts a negative value to move the clock backward", () => {
    const clock = new FakeClock(new Date("2026-05-01T10:01:00.000Z"));
    clock.advance(-60_000);
    expect(clock.now()).toEqual(new Date("2026-05-01T10:00:00.000Z"));
  });

  it("set() jumps to an arbitrary instant", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    clock.set(new Date("2030-12-31T23:59:59.000Z"));
    expect(clock.now()).toEqual(new Date("2030-12-31T23:59:59.000Z"));
  });

  it("now() returns a defensive copy — mutating it does not affect the clock's internal state", () => {
    const clock = new FakeClock(new Date("2026-05-01T10:00:00.000Z"));
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now()).toEqual(new Date("2026-05-01T10:00:00.000Z"));
  });
});
