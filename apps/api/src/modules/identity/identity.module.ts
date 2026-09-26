import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AppConfigModule } from "../../config/app-config.module";
import { DatabaseModule } from "../../database/database.module";
import { SharedModule } from "../shared";
import { LoginUseCase } from "./application/login.use-case";
import {
  ACCESS_TOKEN_SIGNER,
  MEMBERSHIPS_REPOSITORY,
  PASSWORD_HASHER,
  REFRESH_TOKENS_REPOSITORY,
  USERS_REPOSITORY,
} from "./application/ports";
import { RefreshTokenUseCase } from "./application/refresh-token.use-case";
import { RegisterUserUseCase } from "./application/register-user.use-case";
import { AuthController } from "./http/auth.controller";
import { JwtTokenService } from "./infra/jwt-token.service";
import { MembershipsRepository } from "./infra/memberships.repository";
import { PasswordHasher } from "./infra/password-hasher";
import { RefreshTokensRepository } from "./infra/refresh-tokens.repository";
import { UsersRepository } from "./infra/users.repository";

/**
 * Wiring for the `identity` module (ULTRAPLAN 1.2 created this file empty; ULTRAPLAN 1.3
 * fills it in with register/login/refresh). Every `application/ports.ts` token is bound
 * to its concrete `infra/` adapter here — this is the one place in the module allowed to
 * know about both sides of each port (CLAUDE.md rule 2 / `eslint.boundaries.mjs`:
 * `application/` itself never imports `infra/` directly).
 *
 * `AppConfigModule`/`DatabaseModule`/`SharedModule` are already `@Global()` (their
 * exports would be injectable here regardless) — imported explicitly anyway so this
 * module's dependencies are visible just by reading `imports`, matching `HealthModule`'s
 * existing convention. `JwtModule.register({})` is NOT global and registers no default
 * options — see `infra/jwt-token.service.ts`'s doc comment for why every signing call
 * passes its own key/algorithm/TTL instead.
 *
 * Still not `@Global()` itself: nothing outside this module needs anything it exports yet
 * (that decision is revisited whenever some other module needs to, e.g., look up a user by
 * id — `UsersRepositoryPort`'s token is intentionally not exported from this module's
 * `index.ts` today, since CLAUDE.md rule 1 forbids reaching into another module's `infra/`
 * regardless of module-global status anyway).
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, SharedModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    RegisterUserUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    { provide: USERS_REPOSITORY, useClass: UsersRepository },
    { provide: MEMBERSHIPS_REPOSITORY, useClass: MembershipsRepository },
    { provide: REFRESH_TOKENS_REPOSITORY, useClass: RefreshTokensRepository },
    { provide: PASSWORD_HASHER, useClass: PasswordHasher },
    { provide: ACCESS_TOKEN_SIGNER, useClass: JwtTokenService },
  ],
})
export class IdentityModule {}
