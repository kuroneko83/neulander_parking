/**
 * Pure date arithmetic for `application/`'s use cases — kept out of them directly so they
 * never call `new Date()`/do ad-hoc `Date` math inline (CLAUDE.md rule: "'agora' só vem do
 * `Clock` injetado"). Callers pass in `Clock.now()`'s result; this file itself never reads
 * the system clock.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
