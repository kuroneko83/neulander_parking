import { Inject, Injectable } from "@nestjs/common";
import type { InvitationPreview } from "@neulander/contracts";

import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock } from "../../shared";
import { InvitationNotFoundError } from "../domain/invitation-errors";
import { hashOpaqueToken } from "../domain/opaque-token";
import {
  INVITATIONS_REPOSITORY,
  type InvitationsRepositoryPort,
  ORGANIZATIONS_REPOSITORY,
  type OrganizationsRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

/**
 * `GET /v1/invitations/:token` (public — ULTRAPLAN 1.5). Returns the SAME generic `404`
 * (`InvitationNotFoundError`) whether the token is unknown, belongs to an expired/revoked
 * invitation, or one that's already been accepted — "don't leak which" is this endpoint's
 * whole design (see that error's own doc comment).
 */
@Injectable()
export class GetInvitationUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(INVITATIONS_REPOSITORY)
    private readonly invitationsRepository: InvitationsRepositoryPort,
    @Inject(ORGANIZATIONS_REPOSITORY)
    private readonly organizationsRepository: OrganizationsRepositoryPort,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<InvitationPreview> {
    const invitation = await this.invitationsRepository.findByTokenHash(
      this.db,
      hashOpaqueToken(token),
    );
    const now = this.clock.now();

    if (!invitation) {
      throw new InvitationNotFoundError();
    }
    if (
      invitation.revokedAt !== null ||
      invitation.acceptedAt !== null ||
      invitation.expiresAt.getTime() <= now.getTime()
    ) {
      throw new InvitationNotFoundError();
    }

    const organization = await this.organizationsRepository.findById(
      this.db,
      invitation.organizationId,
    );
    if (!organization) {
      // Same invariant-violation reasoning as `InviteMemberUseCase`'s analogous check — an
      // invitation always references a real organization by construction.
      throw new Error(`Organização ${invitation.organizationId} não encontrada.`);
    }

    const user = await this.usersRepository.findByEmail(this.db, invitation.email);

    return {
      organizationName: organization.name,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      userExists: user !== undefined,
    };
  }
}
