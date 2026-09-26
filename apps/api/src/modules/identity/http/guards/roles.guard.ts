import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { GlobalRole, OrganizationRole } from "@neulander/contracts";

import type { AuthenticatedRequest } from "./authenticated-request";
import { ROLES_KEY } from "./roles.decorator";

/**
 * `RolesGuard` (ULTRAPLAN 1.4) — pairs with `@Roles(...)`. Must run AFTER `JwtAuthGuard`
 * (needs `request.user`) and, for an org-scoped route, after `OrgScopeGuard` too (reads
 * `request.membership`, which only `OrgScopeGuard` sets): `@UseGuards(JwtAuthGuard,
 * OrgScopeGuard, RolesGuard)`.
 *
 * No `@Roles()` metadata on a route means "no role restriction beyond being authenticated"
 * — `JwtAuthGuard` alone already covers that route (e.g. `GET /v1/me`, `POST
 * /v1/auth/logout`: any authenticated user, regardless of role, may call them).
 *
 * A route passes if EITHER the caller's `roleGlobal` (e.g. `platform_admin`) is in the
 * required set, OR `request.membership.role` (the org role `OrgScopeGuard` resolved for
 * `:orgId`) is. Checking both, rather than picking one based on the route, is what lets a
 * single `@Roles()` list serve both a hypothetical `platform_admin`-only route and every
 * `/v1/orgs/:orgId/...` route without the guard needing to know in advance which kind of
 * role a given route cares about.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Typed explicitly as `... | undefined`: `Reflector.getAllAndOverride`'s own generic
    // return type is NOT nullable, but at runtime it returns `undefined` when no handler or
    // class in the chain ever set this metadata key (no `@Roles()` on the route at all) —
    // without spelling out `| undefined` here, `@typescript-eslint/no-unnecessary-condition`
    // sees a type that's always truthy and flags the `!requiredRoles` check below as dead.
    const requiredRoles = this.reflector.getAllAndOverride<
      (GlobalRole | OrganizationRole)[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const globalRoleSatisfies =
      request.user.roleGlobal !== null && requiredRoles.includes(request.user.roleGlobal);
    const membershipRoleSatisfies =
      request.membership !== undefined && requiredRoles.includes(request.membership.role);

    if (!globalRoleSatisfies && !membershipRoleSatisfies) {
      throw new ForbiddenException();
    }

    return true;
  }
}
