import { Inject, Injectable } from "@nestjs/common";
import type { AcceptInvitationInput, TokenPair } from "@neulander/contracts";

import { AppConfigService } from "../../../config/app-config.service";
import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock, newId } from "../../shared";
import type { AccessTokenClaims } from "../domain/access-token-claims";
import { addDays } from "../domain/dates";
import {
  InvitationAcceptMissingCredentialsError,
  InvitationExpiredError,
  InvitationNotFoundError,
} from "../domain/invitation-errors";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/opaque-token";
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenServicePort,
  INVITATIONS_REPOSITORY,
  type InvitationsRepositoryPort,
  MEMBERSHIPS_REPOSITORY,
  type MembershipsRepositoryPort,
  PASSWORD_HASHER,
  type PasswordHasherPort,
  REFRESH_TOKENS_REPOSITORY,
  type RefreshTokensRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

export type AcceptInvitationResult = { status: 201; tokenPair: TokenPair } | { status: 204 };

/** The transaction's own outcome, translated to a thrown `DomainError`/the happy-path
 * `AcceptInvitationResult` only AFTER the transaction has committed — same reasoning as
 * `RefreshTokenUseCase`'s `RefreshOutcome` (ULTRAPLAN 1.3): a thrown error inside
 * `db.transaction()` rolls back everything, which would be wrong for `already_accepted`
 * (nothing to roll back — the whole point is that a PRIOR call already committed this). */
type AcceptOutcome =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "missing_credentials" }
  | { kind: "already_accepted" }
  | { kind: "joined" }
  | { kind: "created"; tokenPair: TokenPair };

/**
 * `POST /v1/invitations/:token/accept` (public — ULTRAPLAN 1.5). One state machine per
 * presented token, mirroring `RefreshTokenUseCase`'s structure (lock the row `FOR UPDATE`,
 * branch, decide, return a plain outcome — never throw mid-transaction for an outcome that
 * must survive a concurrent/retried call):
 *
 *  - unknown token → `InvitationNotFoundError` (same generic 404 as the preview endpoint for
 *    this one case — an unknown token here is exactly as uninformative as it is there).
 *  - already accepted → idempotent no-op, `204` (replay of a call that already succeeded,
 *    whichever branch below it originally took).
 *  - revoked, or `expires_at` has passed (and not yet accepted) → `InvitationExpiredError`.
 *  - invited e-mail has NO existing `users` row → requires `{ name, password }` in the body
 *    (`InvitationAcceptMissingCredentialsError` otherwise); creates the user + membership +
 *    marks the invitation accepted + issues a fresh `TokenPair` (mirrors
 *    `LoginUseCase`/`RefreshTokenUseCase`'s own token issuance) → `201`.
 *  - invited e-mail already has a `users` row → creates the membership only, marks the
 *    invitation accepted, no token pair (the web client is expected to log in separately,
 *    api-and-events.md) → `204`.
 */
@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly membershipsRepository: MembershipsRepositoryPort,
    @Inject(INVITATIONS_REPOSITORY)
    private readonly invitationsRepository: InvitationsRepositoryPort,
    @Inject(REFRESH_TOKENS_REPOSITORY)
    private readonly refreshTokensRepository: RefreshTokensRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokenService: AccessTokenServicePort,
    private readonly appConfig: AppConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    tokenPlain: string,
    body: AcceptInvitationInput,
  ): Promise<AcceptInvitationResult> {
    const tokenHash = hashOpaqueToken(tokenPlain);
    const now = this.clock.now();

    const outcome = await this.db.transaction<AcceptOutcome>(async (tx) => {
      const invitation = await this.invitationsRepository.findByTokenHashForUpdate(tx, tokenHash);
      if (!invitation) {
        return { kind: "not_found" };
      }

      if (invitation.acceptedAt !== null) {
        return { kind: "already_accepted" };
      }

      // Checked AFTER already-accepted, deliberately: an invitation that was legitimately
      // accepted before its `expires_at` (the normal case) must still replay as
      // `already_accepted`, not `expired`, even though enough time may have since passed
      // that `expires_at` itself is now in the past — `accepted_at` being set is the only
      // fact that matters once it's set at all.
      if (invitation.revokedAt !== null || invitation.expiresAt.getTime() <= now.getTime()) {
        return { kind: "expired" };
      }

      const existingUser = await this.usersRepository.findByEmail(tx, invitation.email);

      if (!existingUser) {
        if (!body.name || !body.password) {
          return { kind: "missing_credentials" };
        }

        const passwordHash = await this.passwordHasher.hash(body.password);
        const userId = newId();

        await this.usersRepository.insert(tx, {
          id: userId,
          email: invitation.email,
          passwordHash,
          name: body.name,
        });
        await this.membershipsRepository.insert(tx, {
          id: newId(),
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
          parkingLotIds: invitation.parkingLotIds,
        });
        await this.invitationsRepository.markAccepted(tx, invitation.id, now, userId);

        const claims: AccessTokenClaims = {
          sub: userId,
          roleGlobal: null,
          roles: [
            {
              organizationId: invitation.organizationId,
              role: invitation.role,
              parkingLotIds: invitation.parkingLotIds,
            },
          ],
        };
        const accessToken = this.accessTokenService.sign(claims);
        const refreshTokenPlain = generateOpaqueToken();
        await this.refreshTokensRepository.insert(tx, {
          id: newId(),
          userId,
          tokenHash: hashOpaqueToken(refreshTokenPlain),
          familyId: newId(),
          expiresAt: addDays(now, this.appConfig.jwtRefreshTtlDays),
        });

        return { kind: "created", tokenPair: { accessToken, refreshToken: refreshTokenPlain } };
      }

      await this.membershipsRepository.insert(tx, {
        id: newId(),
        organizationId: invitation.organizationId,
        userId: existingUser.id,
        role: invitation.role,
        parkingLotIds: invitation.parkingLotIds,
      });
      await this.invitationsRepository.markAccepted(tx, invitation.id, now, existingUser.id);

      return { kind: "joined" };
    });

    switch (outcome.kind) {
      case "not_found":
        throw new InvitationNotFoundError();
      case "expired":
        throw new InvitationExpiredError();
      case "missing_credentials":
        throw new InvitationAcceptMissingCredentialsError();
      case "already_accepted":
      case "joined":
        return { status: 204 };
      case "created":
        return { status: 201, tokenPair: outcome.tokenPair };
    }
  }
}
