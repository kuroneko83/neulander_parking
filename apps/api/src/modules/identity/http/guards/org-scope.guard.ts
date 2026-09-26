import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, Injectable } from "@nestjs/common";

import type { AuthenticatedRequest } from "./authenticated-request";

/**
 * `OrgScopeGuard` (ULTRAPLAN 1.4) — the second guard on every `/v1/orgs/:orgId/...` route
 * (`@UseGuards(JwtAuthGuard, OrgScopeGuard, ...)`, needs `request.user` from `JwtAuthGuard`
 * to have already run). Two checks, both against the JWT's own `roles` claim — no
 * `memberships` table lookup here, per `AccessTokenClaims`'s own doc comment on why that
 * claim exists in the first place (avoid a DB round trip on every authenticated request);
 * the trade-off is a membership change takes up to `JWT_ACCESS_TTL` to take effect for an
 * already-issued token, which this prototype accepts:
 *
 *  1. **Org membership** — `:orgId` (route param) must match one entry of
 *     `request.user.roles`. Not a member → `403 FORBIDDEN` (not `404`: revealing whether the
 *     organization itself exists to someone who isn't a member of it is not this guard's
 *     job to avoid, but pretending the route doesn't exist at all would be inconsistent with
 *     every other authorization failure in this codebase being a `403`, not a `404`).
 *  2. **Operator lot scope** — when the route ALSO has a `:lotId` param and the resolved
 *     membership's `role` is `operator` with a non-empty `parkingLotIds` (data-model.md:
 *     "escopo do operador; vazio = todos" — empty means unrestricted), `:lotId` must be one
 *     of them. `owner`/`manager` are never restricted this way, and an operator with an
 *     empty `parkingLotIds` (the default) isn't either — only a route with a `:lotId` param
 *     triggers this check at all, so `OrgScopeGuard` on an org-level-only route
 *     (`/v1/orgs/:orgId/members`, say) never applies it.
 *
 * **Known limitation (security review, ULTRAPLAN 1.4 — tracked as a prerequisite on
 * ULTRAPLAN 2.2):** check 2 only fires when the route literally has a `:lotId` path param.
 * A future `operator+` route that resolves its lot indirectly (e.g. by `:sessionId`) is NOT
 * lot-scoped by this guard alone — that route's own use case must additionally check
 * `request.membership.parkingLotIds` against whatever lot the resource it loads belongs to.
 *
 * On success, attaches the resolved membership to `request.membership` — `RolesGuard`
 * (ULTRAPLAN 1.4) reads it to check the org role against a route's `@Roles(...)`, and a
 * controller can read `request.membership.parkingLotIds` directly for any further,
 * business-specific scoping it needs to do itself (e.g. filtering a list query).
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const orgId = request.params["orgId"];
    if (!orgId) {
      // Misconfiguration (this guard applied to a route with no `:orgId` param), not a
      // client-facing failure — mirrors `RefreshTokenUseCase`'s own "genuine invariant
      // violation" throws (ULTRAPLAN 1.3): a plain `Error` here becomes a generic `500` via
      // the global filter, which is the correct outcome for a bug in route wiring.
      throw new Error("OrgScopeGuard aplicado numa rota sem parâmetro :orgId.");
    }

    const membership = request.user.roles.find((role) => role.organizationId === orgId);
    if (!membership) {
      throw new ForbiddenException();
    }

    const lotId = request.params["lotId"];
    if (lotId && membership.role === "operator") {
      // `Array.isArray` guard, not just a type-level assumption (code review, ULTRAPLAN
      // 1.4): `JwtTokenService.verify()` decodes and trusts a JWT payload without runtime
      // schema validation, so an access token issued BEFORE this field existed (still valid
      // for up to `JWT_ACCESS_TTL` after this deploy) reaches here with `parkingLotIds`
      // genuinely absent, despite `AccessTokenClaims`'s static type claiming otherwise.
      // Fails CLOSED on that case — deny rather than treat "unknown scope" as "unrestricted
      // access to every lot", the wrong direction for a security check — so the caller
      // simply gets a real scope back the moment their token refreshes.
      if (!Array.isArray(membership.parkingLotIds)) {
        throw new ForbiddenException();
      }
      if (membership.parkingLotIds.length > 0 && !membership.parkingLotIds.includes(lotId)) {
        throw new ForbiddenException();
      }
    }

    request.membership = membership;
    return true;
  }
}
