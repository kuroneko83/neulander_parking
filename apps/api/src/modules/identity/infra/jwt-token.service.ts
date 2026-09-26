import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { AppConfigService } from "../../../config/app-config.service";
import type { AccessTokenSignerPort } from "../application/ports";
import type { AccessTokenClaims } from "../domain/access-token-claims";

/**
 * RS256 access-token signer (ADR-0004: "access JWT RS256 (15 min)").
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
 * explicitly on each `sign()` call below, read fresh from `AppConfigService` every time,
 * rather than baked into the module at registration time. This keeps the two RS256 keys
 * (private for signing here, public for verification once `JwtAuthGuard` lands in
 * ULTRAPLAN 1.4) out of any Nest module-level config object and sourced from exactly one
 * place (`AppConfigService`), the same as every other config value in this codebase.
 */
@Injectable()
export class JwtTokenService implements AccessTokenSignerPort {
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
}
