import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AppConfigModule } from "../../config/app-config.module";
import { DatabaseModule } from "../../database/database.module";
import { SharedModule } from "../shared";
import { AcceptInvitationUseCase } from "./application/accept-invitation.use-case";
import { GetInvitationUseCase } from "./application/get-invitation.use-case";
import { GetMeUseCase } from "./application/get-me.use-case";
import { InviteMemberUseCase } from "./application/invite-member.use-case";
import { LoginUseCase } from "./application/login.use-case";
import { LogoutUseCase } from "./application/logout.use-case";
import {
  ACCESS_TOKEN_SERVICE,
  INVITATIONS_REPOSITORY,
  MEMBERSHIPS_REPOSITORY,
  ORGANIZATIONS_REPOSITORY,
  PASSWORD_HASHER,
  REFRESH_TOKENS_REPOSITORY,
  USERS_REPOSITORY,
} from "./application/ports";
import { RefreshTokenUseCase } from "./application/refresh-token.use-case";
import { RegisterUserUseCase } from "./application/register-user.use-case";
import { AuthController } from "./http/auth.controller";
import { JwtAuthGuard } from "./http/guards/jwt-auth.guard";
import { OrgScopeGuard } from "./http/guards/org-scope.guard";
import { RolesGuard } from "./http/guards/roles.guard";
import { InvitationsController } from "./http/invitations.controller";
import { MeController } from "./http/me.controller";
import { MembersController } from "./http/members.controller";
import { InvitationsRepository } from "./infra/invitations.repository";
import { JwtTokenService } from "./infra/jwt-token.service";
import { MembershipsRepository } from "./infra/memberships.repository";
import { OrganizationsRepository } from "./infra/organizations.repository";
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
 * `@Global()` (ULTRAPLAN 1.4, new — previously nothing outside this module needed anything
 * it exported): `JwtAuthGuard`/`RolesGuard`/`OrgScopeGuard` are cross-cutting infra every
 * future protected module (facilities, sessions, payments, ...) will `@UseGuards(...)` on
 * its own controllers, exactly the way `SharedModule`'s `IdempotencyInterceptor` is already
 * used outside `modules/shared`. Without `@Global()`, every such module would additionally
 * have to `imports: [IdentityModule]` just to make these three providers resolvable —
 * `@Global()` here is the same trade-off `AppConfigModule`/`DatabaseModule`/`SharedModule`
 * already made, for the same reason (kernel-ish infra used everywhere).
 * `UsersRepositoryPort`/etc.'s tokens are still NOT exported from `index.ts` — `@Global()`
 * only affects DI visibility of what a module actually exports, and CLAUDE.md rule 1
 * (no reaching into another module's `infra/`) is enforced by which tokens `index.ts`
 * re-exports, not by this decorator.
 */
@Global()
@Module({
  imports: [AppConfigModule, DatabaseModule, SharedModule, JwtModule.register({})],
  controllers: [AuthController, MeController, MembersController, InvitationsController],
  providers: [
    RegisterUserUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    GetMeUseCase,
    InviteMemberUseCase,
    GetInvitationUseCase,
    AcceptInvitationUseCase,
    JwtAuthGuard,
    RolesGuard,
    OrgScopeGuard,
    { provide: USERS_REPOSITORY, useClass: UsersRepository },
    { provide: MEMBERSHIPS_REPOSITORY, useClass: MembershipsRepository },
    { provide: REFRESH_TOKENS_REPOSITORY, useClass: RefreshTokensRepository },
    { provide: ORGANIZATIONS_REPOSITORY, useClass: OrganizationsRepository },
    { provide: INVITATIONS_REPOSITORY, useClass: InvitationsRepository },
    { provide: PASSWORD_HASHER, useClass: PasswordHasher },
    { provide: ACCESS_TOKEN_SERVICE, useClass: JwtTokenService },
  ],
  exports: [JwtAuthGuard, RolesGuard, OrgScopeGuard],
})
export class IdentityModule {}
