import { Inject, Injectable } from "@nestjs/common";

import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock } from "../../shared";
import { hashOpaqueToken } from "../domain/refresh-token-crypto";
import {
  REFRESH_TOKENS_REPOSITORY,
  type RefreshTokensRepositoryPort,
} from "./ports";

/**
 * `POST /v1/auth/logout` (ULTRAPLAN 1.4, `JwtAuthGuard`-only) — "revoga família de refresh"
 * (`api-and-events.md`). Revokes only the ONE session's family (the refresh token presented
 * alongside the request, cookie or body — same extraction as `POST /v1/auth/refresh`), not
 * every session the authenticated user has open elsewhere; that mirrors how a real client
 * would log out ("sign out of this device"), not a platform-wide "kill all my sessions"
 * action (which nothing in this codebase's scope asks for).
 *
 * Deliberately silent/idempotent on every "nothing to revoke" case — no token presented, an
 * unknown token, or a token that belongs to a DIFFERENT user than the one `JwtAuthGuard`
 * authenticated (defense in depth: a valid access token paired with someone else's refresh
 * token is not `LogoutUseCase`'s call to escalate into a security event, and "invalid
 * token"/"not yours" would otherwise be exactly the sort of oracle `LoginUseCase`/
 * `RefreshTokenUseCase` already go out of their way to avoid). Logging out always succeeds
 * from the client's perspective.
 */
@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(REFRESH_TOKENS_REPOSITORY)
    private readonly refreshTokensRepository: RefreshTokensRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, refreshTokenPlain: string | undefined): Promise<void> {
    if (!refreshTokenPlain) {
      return;
    }

    const existing = await this.refreshTokensRepository.findByTokenHash(
      this.db,
      hashOpaqueToken(refreshTokenPlain),
    );
    if (existing?.userId !== userId) {
      return;
    }

    await this.refreshTokensRepository.revokeFamily(this.db, existing.familyId, this.clock.now());
  }
}
