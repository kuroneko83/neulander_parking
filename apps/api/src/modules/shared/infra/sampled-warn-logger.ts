import type { Logger } from "@nestjs/common";

/** Default sampling window — see `SampledWarnLogger`'s own doc comment. Exported so a caller
 * (or its own test) can advance a fake clock past it deterministically, the same reason
 * `redis-throttler-storage.ts`'s own `OUTAGE_WARN_INTERVAL_MS` is exported. */
export const SAMPLED_WARN_INTERVAL_MS = 5_000;

interface SampleState {
  lastLoggedAtMs: number;
  suppressedCount: number;
}

/**
 * Round-4 security-review fix (MEDIUM): a small, generic "log a warn at most once per
 * `intervalMs`, per key" helper — extracted out of `RedisThrottlerStorage.logOutageWarnSampled`
 * (round-2 security-review fix, MEDIUM) so the exact same sampling shape can also protect the
 * "request blocked" warns in `LoggingThrottlerGuard`/`IdentifierFailureThrottleInterceptor`.
 *
 * **The bug this closes:** a blocked request is CHEAP server-side (the rate-limit check
 * rejects it before the route handler ever runs — one Redis round trip), so an attacker can
 * sustain thousands of them per second against any throttled route. Before this fix, every
 * single one of those produced a full `warn` log line (each carrying the whole pino-http
 * `req` object) — turning "request blocked" itself into a log-ingestion cost/noise
 * amplifier, on top of the exact kind of flood the Redis-outage sampling (below) was already
 * built to prevent for a DIFFERENT trigger (Redis itself failing).
 *
 * **Keyed, unlike the outage case:** `RedisThrottlerStorage`'s original version tracked one
 * global timestamp/counter for the whole class, which was fine there (one adapter, one Redis,
 * one shared outage). Here the same helper is reused across many different routes/tiers, and
 * a burst against ONE route must not suppress the very first warn for a completely different
 * route that starts getting attacked moments later — so state is tracked per caller-supplied
 * `key` (a route label, in every current caller), each with its own independent window. The
 * per-key state is an in-memory `Map` on the instance, never persisted/shared across
 * processes — approximate under concurrent requests (same trade-off the outage version
 * already accepted), which is fine for a human-facing log line, not a security control.
 *
 * The first occurrence for a given key always logs immediately (never delayed) — this is a
 * volume control on REPEATS, not a way to hide that an attack started.
 */
export class SampledWarnLogger {
  private readonly state = new Map<string, SampleState>();

  constructor(
    private readonly logger: Logger,
    private readonly intervalMs: number = SAMPLED_WARN_INTERVAL_MS,
  ) {}

  /** Logs `message` at `warn`, unless a warn for this exact `key` already fired within the
   * last `intervalMs` — in which case this occurrence is counted and folded into the next
   * warn's "suppressed" suffix instead of being dropped silently. */
  warn(key: string, message: string): void {
    const now = Date.now();
    const existing = this.state.get(key);

    if (existing && now - existing.lastLoggedAtMs < this.intervalMs) {
      existing.suppressedCount += 1;
      return;
    }

    const suppressed = existing?.suppressedCount ?? 0;
    this.state.set(key, { lastLoggedAtMs: now, suppressedCount: 0 });

    const intervalSeconds = String(this.intervalMs / 1000);
    const suppressedSuffix =
      suppressed > 0 ? ` (+${String(suppressed)} ocorrência(s) suprimida(s) nos últimos ~${intervalSeconds}s)` : "";
    this.logger.warn(`${message}${suppressedSuffix}`);
  }
}
