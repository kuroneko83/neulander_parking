import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { ACCESS_TOKEN_SERVICE, type AccessTokenServicePort } from "../../application/ports";
import type { AuthenticatedRequest } from "./authenticated-request";

const BEARER_PREFIX = "Bearer ";

/** Reads `Authorization: Bearer <token>` — anything else (missing header, wrong scheme, no
 * token after the prefix) is treated as "no token presented", never a distinct error case;
 * see the class doc comment for why. */
function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * `JwtAuthGuard` (ULTRAPLAN 1.4) — the first guard on every authenticated route
 * (`@UseGuards(JwtAuthGuard, ...)`). Verifies the `Authorization: Bearer` access token
 * (`AccessTokenServicePort.verify` — RS256, expiry, both enforced by `jsonwebtoken` itself)
 * and, on success, attaches the decoded `AccessTokenClaims` to `request.user` for every
 * downstream guard/controller to read.
 *
 * Deliberately collapses every failure mode — missing header, wrong scheme, malformed
 * token, bad signature, expired token — into the same `401 UNAUTHORIZED`: distinguishing
 * them to the client would only help an attacker calibrate an attack (e.g. "expired" vs.
 * "bad signature" leaks whether a token was ever validly issued), and a legitimate client
 * doesn't need more than "your token doesn't work anymore, go log in or refresh again"
 * either way. Same principle `LoginUseCase`/`RefreshTokenUseCase` (ULTRAPLAN 1.3) already
 * apply to their own auth failures.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokenService: AccessTokenServicePort,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      request.user = this.accessTokenService.verify(token);
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }
}
