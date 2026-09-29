import { createHash } from "node:crypto";

import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Injectable, Logger, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ThrottlerGetTrackerFunction } from "@nestjs/throttler";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { from, switchMap, tap } from "rxjs";

import { maskEmail } from "../domain/mask-email";
import { STRICT_IDENTIFIER_LIMIT, STRICT_IDENTIFIER_THROTTLER, STRICT_WINDOW_MS } from "./rate-limit.config";
import { RedisThrottlerStorage } from "./redis-throttler-storage";
import { SampledWarnLogger } from "./sampled-warn-logger";

const IDENTIFIER_FAILURE_TRACKER_METADATA = Symbol("IDENTIFIER_FAILURE_TRACKER");

/**
 * ULTRAPLAN 1.6 security-review fix (blocking #2): marks a route as protected by the
 * failure-only identifier limiter, and supplies the function that extracts the identifier
 * (e-mail from the body, invite token from the params, ...) from the request. See
 * `IdentifierFailureThrottleInterceptor`'s own doc comment for why this exists as a
 * SEPARATE mechanism from `strictIp`/`moderateIp` (still plain `ThrottlerGuard` tiers).
 */
export function IdentifierFailureThrottle(
  getIdentifier: ThrottlerGetTrackerFunction,
): MethodDecorator {
  return SetMetadata(IDENTIFIER_FAILURE_TRACKER_METADATA, getIdentifier);
}

/**
 * Failure-only per-identifier brute-force limiter (ULTRAPLAN 1.6 security-review fix,
 * blocking #2 — replaces the earlier design, which used a plain `ThrottlerGuard` tier
 * counting EVERY request, success included).
 *
 * **The bug this replaces:** `ThrottlerGuard` increments unconditionally, before the route
 * handler even runs — it has no way to know the eventual outcome. Since the old
 * `strictIdentifier` tier's bucket key was derived purely from attacker-supplied
 * `body.email`, with no authentication required, anyone who knew a user's e-mail (an
 * invite, a leaked address, the org's own site) could send `STRICT_IDENTIFIER_LIMIT`
 * garbage-password login attempts every `STRICT_WINDOW_MS` and permanently lock that
 * person out — even the VICTIM's own correct-password attempt consumed the same shared
 * budget.
 *
 * **Round-1 fix (now itself reverted, see round-2 finding below):** split the check into a
 * read-only `peek()` before the handler and an `increment()` only after a FAILURE. That
 * closed the account-lockout bug, but reintroduced a different one: `peek()` never writes
 * anything, so `N` concurrent requests sharing one identifier all read "0 hits" and all pass
 * the pre-handler gate — the limit was only enforced SERIALLY, never concurrently (a
 * distributed attacker firing attempts in parallel — exactly the threat model this tier
 * exists for, see `rate-limit.config.ts`'s "BOTH must be evaluated" comment — walked straight
 * through it: reproduced live, 60 parallel wrong-password requests against one e-mail, 0
 * blocked).
 *
 * **The fix (round 2, current):** back to a single ATOMIC operation per request —
 * `storage.increment()` (the same Lua-scripted, race-free op `strictIp`/`moderateIp` rely
 * on) runs BEFORE the handler, so concurrent requests sharing an identifier serialize through
 * Redis itself, not through this process. The "success shouldn't cost the victim their own
 * budget" property is kept a different way: a SUCCESSFUL outcome (`tap`) resets the bucket
 * (`storage.reset()`) immediately afterward — wiping out both the hit this very request just
 * recorded and any failed attempts that came before it. A failure needs no extra step: the
 * hit already recorded before the handler ran is exactly the count that should persist.
 *
 * Consequence (matches `strictIp`'s own long-established semantics, see that tier's
 * integration test): the block itself now happens on the very `(limit + 1)`-th call, which
 * gets rejected immediately (no handler execution) rather than on some later call — there is
 * no "peek, then increment on failure" two-step anymore.
 *
 * **Accepted residual risk (documented, not silently ignored):** an attacker who knows a
 * victim's e-mail can still force that account "blocked" for `STRICT_WINDOW_MS` by sending
 * `STRICT_IDENTIFIER_LIMIT` genuinely-wrong-password attempts, repeated indefinitely — no
 * per-identifier rate limit keyed on an attacker-known, unauthenticated value (e-mail,
 * invite token) can fully close this without an orthogonal signal (CAPTCHA, adaptive
 * throttling, ...), which is out of scope for this task. What this fix DOES close is the
 * reviewer's specific finding: a victim's OWN successful/correct actions no longer
 * contribute to their own lockout, AND the limit is enforced against concurrent attempts,
 * not just sequential ones.
 *
 * `strictIp`/`moderateIp` (unaffected by this file, still plain `ThrottlerGuard` tiers via
 * `@UseGuards(ThrottlerGuard)` + `@Throttle()`) intentionally KEEP counting every request
 * regardless of outcome — an IP-keyed bucket can't be turned into an account-lockout
 * weapon against a specific victim the same way, so there's no equivalent bug there to fix
 * (see `rate-limit.config.ts`'s own doc comment).
 *
 * **Concurrency caveat (round-4 security-review fix, LOW — documentation only, no behavior
 * change):** "a successful outcome never contributes to the identifier bucket" (above) is
 * only a durable guarantee for SEQUENTIAL requests. Under concurrency, the block decision for
 * request N happens at the atomic `increment()` call, BEFORE request N's own handler runs and
 * BEFORE its eventual success/failure is known — so a burst of concurrent, ALL-successful
 * login attempts for the same account can still see some of them rejected with a `429`, even
 * though every single one would have succeeded. This is a transient availability/UX artifact,
 * not a durable lockout (each success individually resets the bucket via `reset()` right
 * after, so the very next request self-heals) and gives an attacker no new capability beyond
 * what the sequential case already accepts (see the residual-risk paragraph above) — a
 * concurrent burst of an account's OWN legitimate traffic is not the threat model this
 * interceptor defends against.
 *
 * Round-4 security-review fix (MEDIUM): the block warn below now goes through a
 * `SampledWarnLogger` (keyed by route), same idea/rationale as `LoggingThrottlerGuard`'s own
 * block warn — see that class' doc comment.
 */
@Injectable()
export class IdentifierFailureThrottleInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdentifierFailureThrottleInterceptor.name);
  private readonly blockWarnLogger = new SampledWarnLogger(this.logger);

  constructor(
    private readonly reflector: Reflector,
    private readonly storage: RedisThrottlerStorage,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> | Promise<Observable<unknown>> {
    const getIdentifier = this.reflector.get<ThrottlerGetTrackerFunction | undefined>(
      IDENTIFIER_FAILURE_TRACKER_METADATA,
      context.getHandler(),
    );
    if (!getIdentifier) {
      // Route not decorated with `@IdentifierFailureThrottle(...)` — no-op, same as
      // `@nestjs/throttler`'s own guard when a tier is skipped.
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    return from(Promise.resolve(getIdentifier(request as unknown as Record<string, unknown>, context))).pipe(
      switchMap((identifier) => {
        const key = buildKey(context, identifier);

        // Atomic increment BEFORE the handler runs (round-2 security-review fix, blocking
        // #1) — see class doc comment for why a pre-handler `peek()` isn't safe against
        // concurrent requests.
        return from(
          this.storage.increment(key, STRICT_WINDOW_MS, STRICT_IDENTIFIER_LIMIT, STRICT_WINDOW_MS, STRICT_IDENTIFIER_THROTTLER),
        ).pipe(
          switchMap((incremented) => {
            if (incremented.isBlocked) {
              response.setHeader("Retry-After", incremented.timeToBlockExpire);
              const route = routeLabel(context);
              this.blockWarnLogger.warn(
                route,
                `Rate limit (identificador) estourado — rota=${route} identificador=${maskIdentifier(identifier)}`,
              );
              throw new ThrottlerException();
            }

            return next.handle().pipe(
              tap(() => {
                // Fire-and-forget: a successful outcome resets the bucket — including the
                // hit this very request just recorded above — so a legitimate user's own
                // success never leaves a residual count against them (extra defense-in-depth
                // on top of "the block itself only ever grows off real attempts against this
                // identifier"). The response has already been decided by the time this runs
                // — it must never delay/fail it.
                this.storage.reset(key, STRICT_IDENTIFIER_THROTTLER).catch((error: unknown) => {
                  this.logger.warn(`Falha ao resetar bucket de identificador: ${messageOf(error)}`);
                });
              }),
            );
          }),
        );
      }),
    );
  }
}

/** Own key derivation — deliberately independent of `@nestjs/throttler`'s own
 * `generateKey()` (this tier isn't managed by `ThrottlerGuard` at all anymore). Same LGPD
 * property as the guard-based tiers though: the raw identifier (e-mail/token) is hashed
 * away HERE, before it ever becomes a Redis key or reaches `RedisThrottlerStorage` — that
 * class still never sees a raw identifier. */
function buildKey(context: ExecutionContext, identifier: string): string {
  const routeTag = `${context.getClass().name}.${context.getHandler().name}`;
  return createHash("sha256").update(`${routeTag}:${identifier}`).digest("hex");
}

function routeLabel(context: ExecutionContext): string {
  return `${context.getClass().name}.${context.getHandler().name}`;
}

/** CLAUDE.md rule 10 / LGPD: never log a raw e-mail or invite token. `identifier` here is
 * whatever `trackByBodyField("email")`/`trackByParam("token")` returned — already prefixed
 * (`"body.email:someone@example.com"`, `"param.token:abc123..."`) for Redis-key
 * namespacing, not the bare value — stripped back off here purely so the masked form reads
 * like a normal masked e-mail instead of baking that prefix in. E-mail-shaped identifiers
 * get the same `maskEmail()` used everywhere else; anything else (an invite token, or the
 * `NO_IDENTIFIER_TRACKER` fallback) is truncated hard — a token is a bearer secret, not
 * something with a "safe visible prefix" the way an e-mail's local part is. */
function maskIdentifier(identifier: string): string {
  const value = identifier.includes(":") ? identifier.slice(identifier.indexOf(":") + 1) : identifier;

  if (value.includes("@")) {
    return maskEmail(value);
  }
  // Round-4 security-review fix (LOW): the only non-e-mail identifier today is the invite
  // accept token (`generateOpaqueToken()`, a 32-byte bearer secret) — logging a prefix of the
  // VALUE itself, like `maskEmail` does for e-mails, would put live secret material in logs.
  // A short hash prefix stays correlatable across log lines (same token → same tag) without
  // exposing any bits of the secret, matching how `redact-opaque-tokens.ts` treats this same
  // token everywhere else it could appear in a log line.
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}
