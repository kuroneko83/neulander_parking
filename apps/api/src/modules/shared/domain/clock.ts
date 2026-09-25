/**
 * Injectable clock (ULTRAPLAN 0.5, CLAUDE.md rule 2: "'agora' só vem do Clock injetado,
 * nunca `new Date()` direto em código de domínio/aplicação"). Pure interface — the real
 * implementation (`new Date()`) lives in `infra/system-clock.ts` as a Nest provider;
 * `FakeClock` below is the test double, kept here (not in `infra/`) because it's pure TS
 * with no Nest dependency, same as the interface it implements.
 */
export interface Clock {
  now(): Date;
}

/**
 * Deterministic `Clock` for tests: starts at a fixed instant and only moves when told to.
 * Always returns a defensive copy so callers can't mutate the clock's internal state by
 * mutating the `Date` they got back.
 */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  /** Moves the clock forward (or backward, with a negative value) by `ms` milliseconds. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Jumps the clock to an arbitrary instant. */
  set(date: Date): void {
    this.current = new Date(date);
  }
}
