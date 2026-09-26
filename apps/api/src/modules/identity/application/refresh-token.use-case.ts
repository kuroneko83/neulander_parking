import { Inject, Injectable } from "@nestjs/common";
import type { TokenPair } from "@neulander/contracts";

import { AppConfigService } from "../../../config/app-config.service";
import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock, newId } from "../../shared";
import type { AccessTokenClaims } from "../domain/access-token-claims";
import { RefreshTokenInvalidError, RefreshTokenReuseDetectedError } from "../domain/auth-errors";
import { addDays } from "../domain/dates";
import { generateOpaqueRefreshToken, hashOpaqueToken } from "../domain/refresh-token-crypto";
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenServicePort,
  MEMBERSHIPS_REPOSITORY,
  type MembershipsRepositoryPort,
  REFRESH_TOKENS_REPOSITORY,
  type RefreshTokensRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

/** The transaction's own outcome, translated into a thrown `DomainError` (or the happy
 * path's `TokenPair`) only AFTER the transaction has committed — see the class doc
 * comment for why this can't just `throw` from inside `db.transaction()`. */
type RefreshOutcome =
  { kind: "invalid" } | { kind: "reused" } | { kind: "rotated"; tokenPair: TokenPair };

/**
 * `POST /v1/auth/refresh` (ADR-0004's core mechanism; ULTRAPLAN 1.3 calls this use case
 * "o coração desta tarefa"). One state machine per presented token:
 *
 *  - not found, or found but `expires_at` has passed → `RefreshTokenInvalidError`.
 *  - found AND already `revoked_at` → reuse detected: revoke the entire `family_id`
 *    immediately, then `RefreshTokenReuseDetectedError`.
 *  - found, not revoked, not expired → rotate: revoke this token (`replaced_by` = the new
 *    one's id), insert a new token in the SAME `family_id`, sign a fresh access token.
 *
 * Everything (the lookup, and whichever branch follows) runs inside ONE Drizzle
 * transaction with a row lock (`RefreshTokensRepositoryPort.findByTokenHashForUpdate` —
 * `SELECT ... FOR UPDATE`), so two concurrent requests racing to present the same token
 * can't both observe it as "still valid" and both succeed.
 *
 * Deliberately does NOT `throw` from inside that transaction to signal the
 * "invalid"/"reused" outcomes — `db.transaction()` rolls back everything on a thrown
 * error (proven by `test/shared/outbox.int.test.ts`'s own atomicity test), which would
 * silently undo the family revocation this use case's entire security property depends
 * on. Instead the transaction always returns a plain `RefreshOutcome` and commits
 * normally; only once that's durable does `execute()` translate a non-happy outcome into
 * the `DomainError` the controller/global filter expects.
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly membershipsRepository: MembershipsRepositoryPort,
    @Inject(REFRESH_TOKENS_REPOSITORY)
    private readonly refreshTokensRepository: RefreshTokensRepositoryPort,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokenService: AccessTokenServicePort,
    private readonly appConfig: AppConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(refreshTokenPlain: string): Promise<TokenPair> {
    const tokenHash = hashOpaqueToken(refreshTokenPlain);
    const now = this.clock.now();

    const outcome = await this.db.transaction<RefreshOutcome>(async (tx) => {
      const existing = await this.refreshTokensRepository.findByTokenHashForUpdate(tx, tokenHash);

      if (!existing) {
        return { kind: "invalid" };
      }

      // Checked BEFORE expiry, deliberately: a token can be both revoked and expired (e.g.
      // it was rotated away long enough ago that its own `expires_at` has since passed), and
      // that combination must still be treated as reuse — the whole point of `revokeFamily`
      // is to kill any *other*, still-live token in the family, which the expiry of THIS row
      // says nothing about. Checking expiry first would classify that case as merely
      // "invalid" and silently skip revoking a family that has a real compromise signal.
      if (existing.revokedAt) {
        // Reuse: this exact (already-rotated-away) token is being presented again —
        // someone (the legitimate client replaying a stale token, or an attacker replaying
        // a stolen one) has a token that should no longer exist. ADR-0004's response is to
        // revoke the whole family immediately, right here, so this is durable even though
        // `execute()` still reports failure to the caller below.
        await this.refreshTokensRepository.revokeFamily(tx, existing.familyId, now);
        return { kind: "reused" };
      }

      if (existing.expiresAt.getTime() <= now.getTime()) {
        return { kind: "invalid" };
      }

      const newRefreshId = newId();
      const newRefreshPlain = generateOpaqueRefreshToken();

      // Insert the NEW row before revoking the old one: `replaced_by` is a real FK to
      // `refresh_tokens.id` (data-model.md), so pointing the old row at a new row that
      // doesn't exist yet fails the constraint. Both happen in this same transaction
      // either way, so there's no window where a reader could observe the old token as
      // revoked without the new one existing yet.
      await this.refreshTokensRepository.insert(tx, {
        id: newRefreshId,
        userId: existing.userId,
        tokenHash: hashOpaqueToken(newRefreshPlain),
        familyId: existing.familyId,
        expiresAt: addDays(now, this.appConfig.jwtRefreshTtlDays),
      });
      await this.refreshTokensRepository.revoke(tx, existing.id, now, newRefreshId);

      const user = await this.usersRepository.findById(tx, existing.userId);
      if (!user) {
        // `refresh_tokens.user_id` has a `NOT NULL` FK to `users.id` (data-model.md) and
        // nothing in this codebase deletes a `users` row — this is a genuine invariant
        // violation, not a normal "token invalid" business outcome, so it's allowed to
        // throw here and roll back the rotation above (unlike the reuse branch, there is
        // no revocation this path needs to survive the rollback).
        throw new Error(
          `Refresh token ${existing.id} referencia um usuário inexistente (${existing.userId}).`,
        );
      }

      const memberships = await this.membershipsRepository.findByUserId(tx, existing.userId);
      const claims: AccessTokenClaims = {
        sub: user.id,
        roleGlobal: user.roleGlobal,
        roles: memberships.map((membership) => ({
          organizationId: membership.organizationId,
          role: membership.role,
          parkingLotIds: membership.parkingLotIds,
        })),
      };

      return {
        kind: "rotated",
        tokenPair: {
          accessToken: this.accessTokenService.sign(claims),
          refreshToken: newRefreshPlain,
        },
      };
    });

    if (outcome.kind === "invalid") {
      throw new RefreshTokenInvalidError();
    }
    if (outcome.kind === "reused") {
      throw new RefreshTokenReuseDetectedError();
    }
    return outcome.tokenPair;
  }
}
