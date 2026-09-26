import type { Request } from "express";

import type { AccessTokenClaims } from "../../domain/access-token-claims";

/** One entry of `AccessTokenClaims.roles` — re-exported under this name because
 * `OrgScopeGuard` attaches exactly one of these (the membership matching `:orgId`) to
 * `request.membership`, and "a membership claim" reads clearer at that call site than
 * reaching back into `AccessTokenClaims.roles[number]`. */
export type MembershipClaim = AccessTokenClaims["roles"][number];

/**
 * `Request` as seen by any handler running AFTER `JwtAuthGuard` (ULTRAPLAN 1.4) —
 * `request.user` is guaranteed present at that point (`JwtAuthGuard` throws
 * `UnauthorizedException` before letting the request through otherwise). `request.membership`
 * is only present after `OrgScopeGuard` also ran (routes under `/v1/orgs/:orgId/...`), which
 * is why it's optional here — a plain `@UseGuards(JwtAuthGuard)` route (e.g. `GET /v1/me`)
 * never sets it.
 *
 * A local interface + explicit `getRequest<AuthenticatedRequest>()` cast at each guard/
 * controller call site, rather than global `declare module "express"` augmentation: the
 * global-augmentation approach would make `request.user`/`request.membership` look
 * unconditionally available on every `Request` in the codebase, including requests that
 * never passed through these guards (e.g. `/v1/auth/login` itself) — this way the type only
 * claims what's actually true at each specific call site.
 */
export interface AuthenticatedRequest extends Request {
  user: AccessTokenClaims;
  membership?: MembershipClaim;
}
