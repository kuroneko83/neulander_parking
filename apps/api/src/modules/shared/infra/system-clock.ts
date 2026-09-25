import { Injectable } from "@nestjs/common";

import type { Clock } from "../domain/clock";

/** DI token for the injected `Clock` — `@Inject(CLOCK) private readonly clock: Clock`.
 * A `Symbol` (not the `Clock` interface itself) because interfaces don't exist at
 * runtime, same pattern as `DATABASE_POOL`/`DATABASE_CONNECTION` in `database.module.ts`. */
export const CLOCK = Symbol("CLOCK");

/** Real `Clock` implementation — the only place in `apps/api` allowed to call
 * `new Date()` directly for "now" (CLAUDE.md rule 2). Registered as the `CLOCK` provider
 * in `SharedModule`; every other layer injects `CLOCK`, never imports this class. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
