import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { GlobalRole, OrganizationRole } from "@neulander/contracts";
import { describe, expect, it } from "vitest";

import type { AccessTokenClaims } from "../../domain/access-token-claims";
import type { AuthenticatedRequest, MembershipClaim } from "./authenticated-request";
import { RolesGuard } from "./roles.guard";

function fakeReflector(requiredRoles: (GlobalRole | OrganizationRole)[] | undefined): Reflector {
  return { getAllAndOverride: () => requiredRoles } as unknown as Reflector;
}

function createContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function claimsWithRoleGlobal(roleGlobal: AccessTokenClaims["roleGlobal"]): AccessTokenClaims {
  return { sub: "user-1", roleGlobal, roles: [] };
}

const OPERATOR_MEMBERSHIP: MembershipClaim = {
  organizationId: "org-1",
  role: "operator",
  parkingLotIds: [],
};

describe("RolesGuard", () => {
  it("allows the request through when the route has no @Roles() metadata", () => {
    const guard = new RolesGuard(fakeReflector(undefined));
    const context = createContext({ user: claimsWithRoleGlobal(null) });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows the request through when the route has an empty @Roles() list", () => {
    const guard = new RolesGuard(fakeReflector([]));
    const context = createContext({ user: claimsWithRoleGlobal(null) });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows a matching roleGlobal (e.g. platform_admin) through", () => {
    const guard = new RolesGuard(fakeReflector(["platform_admin"]));
    const context = createContext({ user: claimsWithRoleGlobal("platform_admin") });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows a matching request.membership.role (set by OrgScopeGuard) through", () => {
    const guard = new RolesGuard(fakeReflector(["owner", "manager", "operator"]));
    const context = createContext({
      user: claimsWithRoleGlobal(null),
      membership: OPERATOR_MEMBERSHIP,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("throws ForbiddenException when neither roleGlobal nor membership.role satisfy the required roles", () => {
    const guard = new RolesGuard(fakeReflector(["owner", "manager"]));
    const context = createContext({
      user: claimsWithRoleGlobal(null),
      membership: OPERATOR_MEMBERSHIP,
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("throws ForbiddenException when the route is org-scoped but OrgScopeGuard never ran (no request.membership)", () => {
    const guard = new RolesGuard(fakeReflector(["owner"]));
    const context = createContext({ user: claimsWithRoleGlobal("driver") });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
