import type {
  ThrottlerGetTrackerFunction,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";

import type { AppConfigService } from "../../../config/app-config.service";

/**
 * Rate limit tiers (ULTRAPLAN 1.6, system-design.md:281 — "Redis... por IP e por usuário;
 * mais restrito em login e criação de pagamento").
 *
 * Two DIFFERENT mechanisms, not one:
 *
 *  - `default` / `strictIp` / `moderateIp` — plain `@nestjs/throttler` `ThrottlerGuard`
 *    tiers, registered GLOBALLY (`APP_GUARD` in `app.module.ts`, ULTRAPLAN 1.6
 *    security-review fix, nit #8): EVERY route in the app is protected by `default` (a
 *    generous per-IP floor — a future route with a forgotten decorator degrades to
 *    "generous", never to "unprotected"); `strictIp`/`moderateIp` have deliberately INERT
 *    base limits (`INERT_LIMIT`) so they're a no-op for any route that doesn't explicitly
 *    `@Throttle()` them down to their real numbers — see each route's own decorator in
 *    `modules/identity/http/*.controller.ts`. These intentionally count EVERY request,
 *    success included — an IP-keyed bucket can't be turned into an account-lockout weapon
 *    against a specific victim (unlike the identifier tier below), so there's no
 *    account-lockout risk in counting unconditionally here.
 *  - `strictIdentifier` — NOT a `ThrottlerGuard` tier at all (ULTRAPLAN 1.6 security-review
 *    fix, blocking #2): see `identifier-failure-throttle.interceptor.ts`'s doc comment for
 *    why a per-identifier (e-mail/invite-token) bucket that counts every request — success
 *    included — is an account-lockout DoS vector, and how the failure-only interceptor
 *    fixes it. This file still owns the tier's NAME/limit/window constants (used by that
 *    interceptor), just not a `ThrottlerModuleOptions` entry.
 *
 * `strictIp` + `strictIdentifier` together (login, register, invite-accept — brute-force
 * targets): BOTH must be evaluated — identifier-only misses a distributed attacker
 * spreading attempts across many IPs; IP-only either blocks a whole NAT/office network for
 * one attacker's target, or (worse) lets a single-IP attacker exhaust the limit against
 * MANY different victim accounts before the IP limit itself trips. Numbers below are a
 * deliberate choice for this task, not derived from a formula — see each constant's comment
 * for the one-line rationale.
 *
 * `moderateIp` (refresh, invite-preview GET, member-invite creation POST): anti-abuse/
 * scraping floor, not brute-force; per-IP only, no per-identifier tracking (refresh doesn't
 * have a stable low-cardinality identifier to key on before it's even validated, and the
 * other two are either public-read or already RBAC-guarded).
 */

// --- global default tier (ULTRAPLAN 1.6 security-review fix, nit #8) ---
export const DEFAULT_THROTTLER = "default";
export const DEFAULT_WINDOW_MS = 60 * 1000;
// Generous on purpose — this is a FLOOR for every route in the app, including ones that
// will never need `strictIp`/`moderateIp` at all (health checks, future reads, ...) and
// genuinely high-frequency legitimate clients (a web tab polling occupancy, say). It only
// needs to blunt a runaway/misbehaving client or a forgotten-decorator route, not act as
// real brute-force protection — that's what the two tiers below are for.
export const DEFAULT_IP_LIMIT = 300;

// --- strict tier (15 min window) ---
export const STRICT_WINDOW_MS = 15 * 60 * 1000;
// One legitimate user mistyping a password a few times must never see a 429; 8 attempts in
// 15 min is well above normal typo/retry behavior but tight enough to slow down credential
// stuffing / token guessing against a SINGLE account or invite token. Enforced by
// `IdentifierFailureThrottleInterceptor`, NOT `ThrottlerGuard` — see the class doc comment
// at the top of this file.
export const STRICT_IDENTIFIER_LIMIT = 8;
// Looser than the identifier limit on purpose (see class doc comment above) — bounds a
// distributed/scripted attacker sharing one IP against MANY accounts, without punishing an
// office/NAT full of legitimate users for someone else's failed attempts against a
// different account.
export const STRICT_IP_LIMIT = 30;

// --- moderate tier (1 min window) ---
export const MODERATE_WINDOW_MS = 60 * 1000;
// Refresh/invite-preview are cheap, legitimate, and can be called often by a normal client
// (e.g. a web tab refreshing its access token) — this only needs to blunt scraping/abuse,
// not brute force, hence a much higher cap over a much shorter window than the strict tier.
export const MODERATE_IP_LIMIT = 60;

/** `strictIp`/`moderateIp`'s MODULE-LEVEL base limit — deliberately inert (a no-op in
 * practice) so making `ThrottlerGuard` global (nit #8 above) doesn't ALSO silently apply
 * `STRICT_IP_LIMIT`/`MODERATE_IP_LIMIT` to every undecorated route in the app (health
 * checks, `/v1/me`, future reads, ...). Only a route that explicitly overrides a tier via
 * `@Throttle({ strictIp: { limit: STRICT_IP_LIMIT, ... } })` gets the REAL number. */
const INERT_LIMIT = 1_000_000;

/** `NODE_ENV=test` multiplier (ULTRAPLAN 1.6 "Tests" requirement): integration tests boot
 * the REAL `AppModule` (same wiring as production) against a REAL, persistent Redis
 * (`infra/docker/compose.yml`) — happy-path suites make several `/v1/auth/{register,login}`
 * calls each, from the same loopback IP, and a developer re-running `pnpm test:int`
 * repeatedly within the same 15-minute window would otherwise accumulate hits across runs
 * and eventually 429 a perfectly normal test run. Scaling every limit up by this factor in
 * `NODE_ENV=test` keeps the real Redis-backed code path exercised (unlike swapping in a
 * fake/no-op storage) while making a spurious 429 from normal test traffic effectively
 * impossible. The DEDICATED brute-force test (`test/identity/rate-limit.int.test.ts`)
 * does NOT rely on this multiplier at all — correction (round-4 security-review fix, LOW):
 * it does NOT override `THROTTLER_OPTIONS`, and its `strictIp` describe block reuses the
 * SAME `strictIp` throttler name real routes use (via a throwaway probe controller
 * `@Throttle()`d directly with the raw, non-scaled `STRICT_IP_LIMIT`/`STRICT_WINDOW_MS`
 * constants); it avoids colliding with real routes' buckets simply by sending every request
 * from a fresh, synthetic per-run IP (`freshSyntheticIp()`) rather than by any throttler-name
 * isolation. Its `strictIdentifier` describe block similarly hits the real
 * `/v1/auth/{login,register}` routes directly, isolating itself with a fresh e-mail/token per
 * test instead. */
const TEST_LIMIT_MULTIPLIER = 500;

/** Same multiplier, usable at MODULE-LOAD time (ULTRAPLAN 1.6 security-review fix, nit
 * #8's follow-on issue): `@Throttle({...})` decorator metadata on
 * `auth.controller.ts`/`invitations.controller.ts`/`members.controller.ts` is set ONCE,
 * when those files are first imported — there's no per-request `AppConfigService` DI
 * available at that point the way `buildThrottlerModuleOptions` (below) gets it. Reading
 * `process.env.NODE_ENV` directly here (the ONE narrow, documented exception in this
 * codebase to "config only through `AppConfigService`") is safe specifically because
 * Vitest itself already sets `process.env.NODE_ENV = "test"` before ANY module loads
 * (confirmed empirically — same reason `envSchema`'s own `NODE_ENV` ends up `"test"` in
 * every integration test regardless of what the root `.env` says), so this reads the exact
 * same underlying value `AppConfigService.nodeEnv` would resolve to, just earlier. The
 * `strictIdentifier` tier does NOT apply this multiplier at all (round-4 security-review fix,
 * LOW — corrects a previous version of this comment that wrongly claimed
 * `IdentifierFailureThrottleInterceptor` computes its own multiplier from an injected
 * `AppConfigService`; it doesn't inject one and always uses the raw, unscaled
 * `STRICT_IDENTIFIER_LIMIT`). It doesn't need one: the dedicated brute-force integration test
 * isolates itself from real routes' buckets by using a fresh identifier (e-mail/token) per
 * run, not by loosening the limit — see that test file's own header comment.
 *
 * Exported (round-2 security-review fix, LOW) purely so `configure-app.ts` can assert
 * against it at startup: reading `process.env.NODE_ENV` directly here is the one documented
 * exception in this codebase to "config only through `AppConfigService`" (see above), which
 * means a misconfigured deployment (`NODE_ENV=test` leaking into a real task definition)
 * would otherwise silently make every strict-tier limit 500x looser with no signal at all —
 * `assertRateLimitMultiplierIsSafeForProduction` (`configure-app.ts`) fails bootstrap loudly
 * instead if this constant isn't `1` outside a Vitest process (round-4 security-review
 * correction: NOT keyed off `AppConfigService.isProduction` anymore — that read from the
 * exact same `NODE_ENV` this constant does, making the two conditions mutually exclusive by
 * construction and the guard's `throw` branch unreachable; see that function's own doc
 * comment). */
export const DECORATOR_TIME_MULTIPLIER = process.env["NODE_ENV"] === "test" ? TEST_LIMIT_MULTIPLIER : 1;

/** The REAL `strictIp` limit a route opts into via `@Throttle({ [STRICT_IP_THROTTLER]: {
 * limit: EFFECTIVE_STRICT_IP_LIMIT, ttl: STRICT_WINDOW_MS } })` — `STRICT_IP_LIMIT` scaled
 * by `DECORATOR_TIME_MULTIPLIER`. */
export const EFFECTIVE_STRICT_IP_LIMIT = STRICT_IP_LIMIT * DECORATOR_TIME_MULTIPLIER;
/** Same idea for `moderateIp` — see `EFFECTIVE_STRICT_IP_LIMIT`. */
export const EFFECTIVE_MODERATE_IP_LIMIT = MODERATE_IP_LIMIT * DECORATOR_TIME_MULTIPLIER;

/** Returned by a tracker when the field it looks for isn't present (e.g. a malformed body
 * that hasn't reached the Zod validation pipe yet — trackers run before pipes, whether via
 * `ThrottlerGuard` or `IdentifierFailureThrottleInterceptor`). A shared constant bucket for
 * that edge case is an accepted simplification: it only matters pre-validation, and every
 * caller of a tracker hashes its result before it ever becomes a Redis key — never logged,
 * never persisted raw. */
export const NO_IDENTIFIER_TRACKER = "no-identifier";

/**
 * Generic, reusable tracker builders (not identity-specific) — a future module (e.g.
 * payments, per system-design.md's own "mais restrito em... criação de pagamento") can
 * reuse these the same way `identity`'s controllers do, instead of hand-rolling another
 * `getTracker` closure. Each returns the RAW field value (lowercased/trimmed where it makes
 * sense) — never hashed here; hashing happens downstream, in each caller (`@nestjs/throttler`'s
 * own default `generateKey()` for `strictIp`/`moderateIp`, `IdentifierFailureThrottleInterceptor`'s
 * own `buildKey()` for `strictIdentifier`), never in this module.
 */
export function trackByBodyField(field: string): ThrottlerGetTrackerFunction {
  return (req: Record<string, unknown>) => {
    const body = req["body"];
    const raw = isRecord(body) ? body[field] : undefined;
    return typeof raw === "string" && raw.trim().length > 0
      ? `body.${field}:${raw.trim().toLowerCase()}`
      : NO_IDENTIFIER_TRACKER;
  };
}

export function trackByParam(name: string): ThrottlerGetTrackerFunction {
  return (req: Record<string, unknown>) => {
    const params = req["params"];
    const raw = isRecord(params) ? params[name] : undefined;
    return typeof raw === "string" && raw.length > 0
      ? `param.${name}:${raw}`
      : NO_IDENTIFIER_TRACKER;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const STRICT_IP_THROTTLER = "strictIp";
export const STRICT_IDENTIFIER_THROTTLER = "strictIdentifier";
export const MODERATE_IP_THROTTLER = "moderateIp";

/**
 * Builds the `ThrottlerModuleOptions` used by `ThrottlerModule.forRootAsync` in
 * `shared.module.ts`. Pure function (given its two inputs) so it's unit-testable without
 * booting Nest — see `rate-limit.config.test.ts`.
 *
 * `setHeaders: false` on every tier (ULTRAPLAN 1.6 security-review fix, nit #5): the
 * default `X-RateLimit-Limit-<tier>`/`X-RateLimit-Remaining-<tier>`/`X-RateLimit-Reset-<tier>`
 * headers leak internal tier names AND give an attacker a live pacing oracle (read
 * `X-RateLimit-Remaining-strictIp` and sit at `limit - 1` forever without ever tripping a
 * `429`).
 *
 * Round-2 security-review correction: the comment that used to sit here claimed the bare
 * `Retry-After` header on an actual `429` was "unaffected" by `setHeaders: false` — checked
 * against the actual installed `@nestjs/throttler@6.7.1` source
 * (`ThrottlerGuard.handleRequest`), that's FALSE: `Retry-After` is set inside the exact same
 * `if (setHeaders) { ... }` block as the `X-RateLimit-*` headers, so `strictIp`/`moderateIp`
 * (both `setHeaders: false`) were silently emitting `429`s with NO `Retry-After` at all.
 * `LoggingThrottlerGuard.throwThrottlingException` (`logging-throttler.guard.ts`) now sets
 * the bare header itself, explicitly, from `timeToBlockExpire` — independent of
 * `setHeaders` — so `setHeaders: false` still only suppresses the tier-naming/pacing-oracle
 * headers, never the one header a legitimate client actually needs to back off correctly.
 * `strictIdentifier` (`IdentifierFailureThrottleInterceptor`, not a `ThrottlerGuard` tier at
 * all) already set this header itself from the start — unaffected by any of this.
 */
export function buildThrottlerModuleOptions(
  appConfig: AppConfigService,
  storage: ThrottlerStorage,
): ThrottlerModuleOptions {
  const multiplier = appConfig.nodeEnv === "test" ? TEST_LIMIT_MULTIPLIER : 1;

  return {
    storage,
    throttlers: [
      {
        name: DEFAULT_THROTTLER,
        ttl: DEFAULT_WINDOW_MS,
        limit: DEFAULT_IP_LIMIT * multiplier,
        setHeaders: false,
      },
      {
        name: STRICT_IP_THROTTLER,
        ttl: STRICT_WINDOW_MS,
        limit: INERT_LIMIT,
        setHeaders: false,
      },
      {
        name: MODERATE_IP_THROTTLER,
        ttl: MODERATE_WINDOW_MS,
        limit: INERT_LIMIT,
        setHeaders: false,
      },
    ],
  };
}
