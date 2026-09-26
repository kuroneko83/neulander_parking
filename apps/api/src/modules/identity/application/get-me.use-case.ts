import { Inject, Injectable } from "@nestjs/common";
import type { Me } from "@neulander/contracts";

import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import {
  MEMBERSHIPS_REPOSITORY,
  type MembershipsRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

/**
 * `GET /v1/me` (ULTRAPLAN 1.4, `JwtAuthGuard`-only — every authenticated user, any role, may
 * call it). Reads fresh from `users`/`memberships` rather than returning `request.user`'s
 * JWT claims verbatim: `AccessTokenClaims` deliberately excludes PII (email/name/phone —
 * ADR-0004 doesn't call for it, and it'd go stale for up to `JWT_ACCESS_TTL` either way),
 * and this endpoint's whole purpose is to hand the client an up-to-date profile — the same
 * "up to 15 min stale" trade-off `OrgScopeGuard` accepts for authorization checks would be
 * the wrong one for the web org-selector screen (ULTRAPLAN 1.7) this endpoint feeds.
 */
@Injectable()
export class GetMeUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly membershipsRepository: MembershipsRepositoryPort,
  ) {}

  async execute(userId: string): Promise<Me> {
    const user = await this.usersRepository.findById(this.db, userId);
    if (!user) {
      // `userId` is `JwtAuthGuard`'s verified JWT `sub` — under normal operation this always
      // resolves to a real, non-deleted user (no flow deletes/deactivates one yet, same
      // invariant `RefreshTokenUseCase` documents for its own analogous lookup). A plain
      // `Error` here becomes a generic `500` via the global filter, which is the right
      // outcome for a genuine invariant violation rather than a normal business outcome.
      throw new Error(`Usuário autenticado ${userId} não foi encontrado.`);
    }

    const memberships = await this.membershipsRepository.findByUserId(this.db, userId);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(user.phone ? { phone: user.phone } : {}),
      roleGlobal: user.roleGlobal,
      memberships: memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
        parkingLotIds: membership.parkingLotIds,
      })),
    };
  }
}
