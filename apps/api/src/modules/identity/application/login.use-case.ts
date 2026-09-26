import { Inject, Injectable } from "@nestjs/common";
import type { LoginInput, TokenPair } from "@neulander/contracts";

import { AppConfigService } from "../../../config/app-config.service";
import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock, newId } from "../../shared";
import type { AccessTokenClaims } from "../domain/access-token-claims";
import { InvalidCredentialsError } from "../domain/auth-errors";
import { addDays } from "../domain/dates";
import { generateOpaqueRefreshToken, hashOpaqueToken } from "../domain/refresh-token-crypto";
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSignerPort,
  MEMBERSHIPS_REPOSITORY,
  type MembershipsRepositoryPort,
  PASSWORD_HASHER,
  type PasswordHasherPort,
  REFRESH_TOKENS_REPOSITORY,
  type RefreshTokensRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

/**
 * `POST /v1/auth/login` (ULTRAPLAN 1.3). Issues a fresh `TokenPair`: an RS256 access JWT
 * (`AccessTokenSignerPort`) plus a brand-new refresh token family (`family_id = newId()`,
 * ADR-0004) — every successful login starts its own family, independent of any other
 * session the same user already has open elsewhere.
 *
 * Security requirement from the task (tested explicitly in
 * `test/identity/auth.int.test.ts`): a wrong password and a non-existent e-mail return
 * the exact same `InvalidCredentialsError` — same `code`, same message, same `401`. This
 * is why the "user not found" branch returns *before* ever calling
 * `PasswordHasherPort.verify` rather than, say, verifying against a dummy hash to
 * equalize timing — a constant-time response here isn't a goal ULTRAPLAN 1.3 asks for
 * (rate limiting, the actual mitigation for both timing- and brute-force-style attacks on
 * this endpoint, is explicitly out of scope — ULTRAPLAN 1.6), only response *content*
 * indistinguishability is.
 */
@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly membershipsRepository: MembershipsRepositoryPort,
    @Inject(REFRESH_TOKENS_REPOSITORY)
    private readonly refreshTokensRepository: RefreshTokensRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    @Inject(ACCESS_TOKEN_SIGNER) private readonly accessTokenSigner: AccessTokenSignerPort,
    private readonly appConfig: AppConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: LoginInput): Promise<TokenPair> {
    const user = await this.usersRepository.findByEmail(this.db, input.email);
    if (!user) {
      throw new InvalidCredentialsError();
    }

    const passwordValid = await this.passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new InvalidCredentialsError();
    }

    const memberships = await this.membershipsRepository.findByUserId(this.db, user.id);
    const claims: AccessTokenClaims = {
      sub: user.id,
      roleGlobal: user.roleGlobal,
      roles: memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
      })),
    };
    const accessToken = this.accessTokenSigner.sign(claims);

    const now = this.clock.now();
    const refreshToken = generateOpaqueRefreshToken();
    // A single insert needs no explicit `db.transaction()` — Postgres already commits one
    // statement atomically; nothing else needs to happen alongside it (login isn't a
    // documented outbox-event source, unlike registration).
    await this.refreshTokensRepository.insert(this.db, {
      id: newId(),
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshToken),
      familyId: newId(),
      expiresAt: addDays(now, this.appConfig.jwtRefreshTtlDays),
    });

    return { accessToken, refreshToken };
  }
}
