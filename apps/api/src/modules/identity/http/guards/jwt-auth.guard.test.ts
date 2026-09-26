import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AccessTokenServicePort } from "../../application/ports";
import type { AccessTokenClaims } from "../../domain/access-token-claims";
import type { AuthenticatedRequest } from "./authenticated-request";
import { JwtAuthGuard } from "./jwt-auth.guard";

const CLAIMS: AccessTokenClaims = { sub: "user-1", roleGlobal: "driver", roles: [] };

// Same `as unknown as ExecutionContext` pattern already used for `ArgumentsHost` in
// `problem-details.exception-filter.test.ts` — `ExecutionContext` has members this guard
// never calls (`getClass`, `getArgs`, ...), so a plain object isn't structurally assignable.
function createContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function fakeAccessTokenService(
  verify: (token: string) => AccessTokenClaims,
): AccessTokenServicePort {
  return { sign: vi.fn(), verify };
}

describe("JwtAuthGuard", () => {
  it("attaches the decoded claims to request.user and allows the request through", () => {
    const guard = new JwtAuthGuard(fakeAccessTokenService(() => CLAIMS));
    const { context, request } = createContext({ authorization: "Bearer a-valid-token" });

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBe(CLAIMS);
  });

  it("throws UnauthorizedException when there is no Authorization header", () => {
    const guard = new JwtAuthGuard(fakeAccessTokenService(() => CLAIMS));
    const { context } = createContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it.each(["Basic dXNlcjpwYXNz", "Bearer", "Bearer "])(
    "throws UnauthorizedException for a non-Bearer or empty-token Authorization header (%s)",
    (authorization) => {
      const guard = new JwtAuthGuard(fakeAccessTokenService(() => CLAIMS));
      const { context } = createContext({ authorization });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    },
  );

  it("throws UnauthorizedException (never leaking the underlying reason) when verify() throws", () => {
    const verify = vi.fn(() => {
      throw new Error("jwt expired");
    });
    const guard = new JwtAuthGuard(fakeAccessTokenService(verify));
    const { context } = createContext({ authorization: "Bearer an-expired-token" });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(verify).toHaveBeenCalledWith("an-expired-token");
  });
});
