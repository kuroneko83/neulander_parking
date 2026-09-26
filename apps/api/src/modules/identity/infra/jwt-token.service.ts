import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { AppConfigService } from "../../../config/app-config.service";
import type { AccessTokenServicePort } from "../application/ports";
import type { AccessTokenClaims } from "../domain/access-token-claims";

/** Raw JWT payload shape as `jsonwebtoken` returns it from `verify()` — `AccessTokenClaims`
 * plus the standard `iat`/`exp` registered claims neither this service nor any caller needs
 * (expiry is already enforced by `verify()` itself throwing `TokenExpiredError`). */
type AccessTokenJwtPayload = AccessTokenClaims & { iat: number; exp: number };

/**
 * RS256 access-token signer/verifier (ADR-0004: "access JWT RS256 (15 min)").
 *
 * Library choice — `@nestjs/jwt` over raw `jsonwebtoken` (both were on the table per the
 * task): `@nestjs/jwt` is a thin, officially-maintained NestJS wrapper around
 * `jsonwebtoken` itself (its only runtime dependency — no extra algorithmic surface), and
 * this module already wires every other adapter through Nest's DI container. An
 * injectable `JwtService` fits that pattern directly (`private readonly jwtService:
 * JwtService` like any other provider) instead of this file reaching for
 * `import jwt from "jsonwebtoken"` and calling free functions — marginal ergonomic win,
 * but a real one given everything around it is already DI-shaped, and it's the
 * "boringly standard" choice for a NestJS codebase specifically (matches what the Nest
 * docs themselves recommend for JWT auth).
 *
 * `JwtModule.register({})` (see `identity.module.ts`) is registered with NO default
 * `secret`/`privateKey`/`publicKey`/`signOptions` — every one of those is passed
 * explicitly on each `sign()`/`verify()` call below, read fresh from `AppConfigService`
 * every time, rather than baked into the module at registration time. This keeps the two
 * RS256 keys (private for signing, public for verification) out of any Nest module-level
 * config object and sourced from exactly one place (`AppConfigService`), the same as every
 * other config value in this codebase.
 *
 * `verify()` (ULTRAPLAN 1.4, `JwtAuthGuard`'s only dependency) passes `algorithms: ["RS256"]`
 * explicitly — security-review requirement from ULTRAPLAN 1.3: never let `jsonwebtoken`
 * trust the token's own (attacker-controlled) `alg` header, which is the classic
 * `alg: none`/HS256-key-confusion JWT vulnerability class. Pinning it here is what actually
 * closes that hole; `sign()` setting `algorithm: "RS256"` on the way out was necessary but
 * not sufficient on its own.
 */
@Injectable()
export class JwtTokenService implements AccessTokenServicePort {
  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
  ) {}

  sign(claims: AccessTokenClaims): string {
    return this.jwtService.sign(
      { sub: claims.sub, roleGlobal: claims.roleGlobal, roles: claims.roles },
      {
        algorithm: "RS256",
        privateKey: this.appConfig.jwtAccessPrivateKey,
        expiresIn: this.appConfig.jwtAccessTtl,
      },
    );
  }

  verify(token: string): AccessTokenClaims {
    const payload = this.jwtService.verify<AccessTokenJwtPayload>(token, {
      algorithms: ["RS256"],
      publicKey: this.appConfig.jwtAccessPublicKey,
    });
    return { sub: payload.sub, roleGlobal: payload.roleGlobal, roles: payload.roles };
  }
}
