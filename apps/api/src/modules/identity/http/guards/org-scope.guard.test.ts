import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { AccessTokenClaims } from "../../domain/access-token-claims";
import type { AuthenticatedRequest } from "./authenticated-request";
import { OrgScopeGuard } from "./org-scope.guard";

const ORG_ID = "org-1";
const OTHER_ORG_ID = "org-2";
const LOT_ID = "lot-1";
const OTHER_LOT_ID = "lot-2";

function createContext(
  params: Record<string, string | undefined>,
  claims: AccessTokenClaims,
): { context: ExecutionContext; request: Partial<AuthenticatedRequest> } {
  const request: Partial<AuthenticatedRequest> = { params: params as never, user: claims };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("OrgScopeGuard", () => {
  it("allows the request and attaches request.membership when :orgId is one of the user's memberships", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: ORG_ID, role: "manager", parkingLotIds: [] }],
    };
    const { context, request } = createContext({ orgId: ORG_ID }, claims);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.membership).toEqual({ organizationId: ORG_ID, role: "manager", parkingLotIds: [] });
  });

  it("throws ForbiddenException when :orgId is not among the user's memberships", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: OTHER_ORG_ID, role: "owner", parkingLotIds: [] }],
    };
    const { context } = createContext({ orgId: ORG_ID }, claims);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("throws a plain Error (misconfiguration, not a client error) when the route has no :orgId param", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = { sub: "user-1", roleGlobal: null, roles: [] };
    const { context } = createContext({}, claims);

    expect(() => guard.canActivate(context)).toThrow(/sem parâmetro :orgId/);
  });

  it("allows an owner/manager through regardless of :lotId (never lot-scoped)", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: ORG_ID, role: "owner", parkingLotIds: [LOT_ID] }],
    };
    const { context } = createContext({ orgId: ORG_ID, lotId: OTHER_LOT_ID }, claims);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows an operator with an empty parkingLotIds (unrestricted) through any :lotId", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: ORG_ID, role: "operator", parkingLotIds: [] }],
    };
    const { context } = createContext({ orgId: ORG_ID, lotId: OTHER_LOT_ID }, claims);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows an operator scoped to :lotId through", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: ORG_ID, role: "operator", parkingLotIds: [LOT_ID] }],
    };
    const { context } = createContext({ orgId: ORG_ID, lotId: LOT_ID }, claims);

    expect(guard.canActivate(context)).toBe(true);
  });

  it("throws ForbiddenException for an operator whose parkingLotIds does not include :lotId", () => {
    const guard = new OrgScopeGuard();
    const claims: AccessTokenClaims = {
      sub: "user-1",
      roleGlobal: null,
      roles: [{ organizationId: ORG_ID, role: "operator", parkingLotIds: [LOT_ID] }],
    };
    const { context } = createContext({ orgId: ORG_ID, lotId: OTHER_LOT_ID }, claims);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
