import type { ExecutionContext } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard } from "@nestjs/throttler";
import type { Response } from "express";

import { SampledWarnLogger } from "./sampled-warn-logger";

/**
 * `ThrottlerGuard` subclass whose ONLY change is logging a `warn` line whenever it actually
 * blocks a request (ULTRAPLAN 1.6 security-review fix, nit: "no log line when a limit is
 * exceeded"). Registered as the `APP_GUARD` in `app.module.ts` INSTEAD OF the bare
 * `@nestjs/throttler` `ThrottlerGuard` — this is what protects the `default`/`strictIp`/
 * `moderateIp` tiers globally; `strictIdentifier` is a completely separate mechanism
 * (`IdentifierFailureThrottleInterceptor`, which already logs its own `warn` on block —
 * see that file).
 *
 * Constructor re-declares the exact same `@InjectThrottlerOptions()`/`@InjectThrottlerStorage()`
 * parameter decorators the base class' own constructor has: Nest's DI metadata for those two
 * custom parameter decorators is only recorded against the class whose constructor they're
 * physically written on (unlike `design:paramtypes`, which TypeScript's emitted implicit
 * `super(...arguments)` constructor WOULD inherit) — an implicit constructor here would
 * resolve `options`/`storageService` as plain, un-injectable `Object` tokens and fail to
 * boot. `reflector` doesn't need a decorator (plain class-token injection works either way);
 * kept for symmetry with the two neighbors.
 *
 * Only `throwThrottlingException` is overridden — every other tier/limit/tracker/key/header
 * behavior is untouched, inherited as-is from `ThrottlerGuard` — EXCEPT the bare
 * `Retry-After` header, which this override now sets explicitly (round-2 security-review
 * fix, MEDIUM): in the installed `@nestjs/throttler@6.7.1`, `ThrottlerGuard.handleRequest`
 * only sets `Retry-After` (and the `X-RateLimit-*` headers) when `setHeaders` is truthy —
 * `rate-limit.config.ts` sets `setHeaders: false` on every `ThrottlerGuard`-managed tier
 * (`default`/`strictIp`/`moderateIp`) specifically to suppress the `X-RateLimit-*` headers
 * (tier-name leak + pacing oracle), which as an unintended side effect ALSO suppressed
 * `Retry-After` on those same tiers' `429`s — the one header a legitimate client actually
 * needs to back off correctly, and the one `ProblemDetailsExceptionFilter.normalizeRetryAfterHeader`
 * expects to find. Setting it here, unconditionally, restores it without reintroducing the
 * headers `setHeaders: false` was meant to suppress.
 *
 * IP addresses are personal data (LGPD, CLAUDE.md rule 10 — the rule's own list is
 * email/CPF/plate/token, but the same "não logar em claro" principle extends to any
 * identifying value); `maskTracker()` below partially masks the tracker (normally a
 * normalized client IP — see `ThrottlerGuard.getTracker()`) the exact same way
 * `maskEmail()`/`maskPlate()` mask their own respective values elsewhere in this codebase —
 * enough left visible to correlate repeat hits in a log search, never enough to identify a
 * specific client.
 *
 * Round-4 security-review fix (MEDIUM): the block warn below now goes through a
 * `SampledWarnLogger` (keyed by route), same idea as `RedisThrottlerStorage`'s own
 * Redis-outage sampling — a blocked request is cheap server-side (rejected before the route
 * handler even runs), so without sampling an attacker sustaining thousands of blocked
 * requests per second turns this very "request blocked" warn into a log-ingestion cost/noise
 * amplifier. See `SampledWarnLogger`'s own doc comment for the full rationale.
 */
@Injectable()
export class LoggingThrottlerGuard extends ThrottlerGuard {
  private readonly rateLimitLogger = new Logger(LoggingThrottlerGuard.name);
  private readonly blockWarnLogger = new SampledWarnLogger(this.rateLimitLogger);

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const routeLabel = `${context.getClass().name}.${context.getHandler().name}`;
    this.blockWarnLogger.warn(
      routeLabel,
      `Rate limit (IP) estourado — rota=${routeLabel} ip=${maskTracker(throttlerLimitDetail.tracker)}`,
    );

    // Round-2 security-review fix (MEDIUM) — see class doc comment: `setHeaders: false`
    // (`rate-limit.config.ts`) suppresses this same header inside the base class, so it's
    // set here instead, unconditionally, straight from `timeToBlockExpire` (already in
    // seconds — same unit `ThrottlerGuard`'s own `setResponseHeader(res, "Retry-After",
    // timeToBlockExpire)` call would have used).
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader("Retry-After", throttlerLimitDetail.timeToBlockExpire);

    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}

/** Partial mask for a `ThrottlerGuard` tracker value — in practice always a normalized
 * client IP (v4 or v6; `default`/`strictIp`/`moderateIp` never override `getTracker`, see
 * each controller's own doc comment) but written defensively against any string shape.
 * Never throws — safe to call right before a log line on arbitrary input, same contract as
 * `maskEmail()`/`maskPlate()`. Exported (not just used internally) purely so it has its own
 * focused unit test, same pattern as `redis-throttler-storage.ts`'s `parseIncrementReply`. */
export function maskTracker(tracker: string): string {
  if (tracker.includes(".")) {
    // IPv4: mask only the last octet ("203.0.113.42" -> "203.0.113.*").
    const parts = tracker.split(".");
    if (parts.length === 4) {
      return `${parts.slice(0, 3).join(".")}.*`;
    }
  }
  if (tracker.includes(":")) {
    // IPv6 (possibly subnet-truncated already by `normalizeIp`): keep the first two groups.
    const groups = tracker.split(":");
    return `${groups.slice(0, 2).join(":")}::*`;
  }
  return tracker.length <= 4 ? "***" : `${tracker.slice(0, 4)}***`;
}
