import { Inject, Injectable } from "@nestjs/common";
import type { CreateInvitationInput, InvitationView, OrganizationRole } from "@neulander/contracts";

import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock, newId, OutboxService } from "../../shared";
import { addDays } from "../domain/dates";
import {
  InvitationAlreadyPendingError,
  InviteRoleNotAllowedError,
  MemberAlreadyExistsError,
  ParkingLotScopeUnavailableError,
} from "../domain/invitation-errors";
import { canInviteRole } from "../domain/invite-policy";
import { generateOpaqueToken, hashOpaqueToken } from "../domain/opaque-token";
import {
  INVITATIONS_REPOSITORY,
  type InvitationsRepositoryPort,
  MEMBERSHIPS_REPOSITORY,
  type MembershipsRepositoryPort,
  ORGANIZATIONS_REPOSITORY,
  type OrganizationsRepositoryPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

/** `invitations.expires_at` (data-model.md: "expires_at (7 dias)") — fixed, not configurable
 * per organization; nothing in this task's contracts/docs calls for that. */
const INVITATION_TTL_DAYS = 7;

export interface InviteMemberInput {
  organizationId: string;
  invitedByUserId: string;
  invitedByRole: OrganizationRole;
  input: CreateInvitationInput;
}

/**
 * `POST /v1/orgs/:orgId/members` (ULTRAPLAN 1.5). Writes the `invitations` row and publishes
 * `identity.member_invited.v1` to the outbox in the SAME transaction (CLAUDE.md rule 7) —
 * `notifications` (the only documented consumer) sends the invite e-mail from a separate
 * worker process entirely, never inside this transaction.
 *
 * Order of checks: role-escalation (`canInviteRole`, no DB access needed) first, then
 * `parkingLotIds` (also no DB access), then the two DB-backed checks (existing member,
 * pending invite) inside the transaction — cheapest/no-I-O checks fail fast before opening a
 * transaction for input that's going to be rejected anyway.
 */
@Injectable()
export class InviteMemberUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(MEMBERSHIPS_REPOSITORY)
    private readonly membershipsRepository: MembershipsRepositoryPort,
    @Inject(ORGANIZATIONS_REPOSITORY)
    private readonly organizationsRepository: OrganizationsRepositoryPort,
    @Inject(INVITATIONS_REPOSITORY)
    private readonly invitationsRepository: InvitationsRepositoryPort,
    private readonly outboxService: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(request: InviteMemberInput): Promise<InvitationView> {
    const { organizationId, invitedByUserId, invitedByRole, input } = request;

    if (!canInviteRole(invitedByRole, input.role)) {
      throw new InviteRoleNotAllowedError();
    }
    if (input.parkingLotIds.length > 0) {
      throw new ParkingLotScopeUnavailableError();
    }

    const now = this.clock.now();
    const expiresAt = addDays(now, INVITATION_TTL_DAYS);
    const token = generateOpaqueToken();
    const invitationId = newId();

    return this.db.transaction(async (tx) => {
      const existingUser = await this.usersRepository.findByEmail(tx, input.email);
      if (existingUser) {
        const alreadyMember = await this.membershipsRepository.existsForOrganizationAndUser(
          tx,
          organizationId,
          existingUser.id,
        );
        if (alreadyMember) {
          throw new MemberAlreadyExistsError();
        }
      }

      const pending = await this.invitationsRepository.findPendingByOrganizationAndEmail(
        tx,
        organizationId,
        input.email,
      );
      if (pending) {
        throw new InvitationAlreadyPendingError();
      }

      const organization = await this.organizationsRepository.findById(tx, organizationId);
      if (!organization) {
        // `OrgScopeGuard` already resolved `:orgId` against the caller's own JWT claims
        // before this use case ever runs — a missing organization row here would mean the
        // claim referenced an organization that no longer exists, a genuine invariant
        // violation (same "not a normal business outcome" reasoning as
        // `RefreshTokenUseCase`'s analogous check), not something a client caused.
        throw new Error(`Organização ${organizationId} não encontrada.`);
      }

      await this.invitationsRepository.insert(tx, {
        id: invitationId,
        organizationId,
        email: input.email,
        role: input.role,
        parkingLotIds: [],
        tokenHash: hashOpaqueToken(token),
        invitedByUserId,
        expiresAt,
      });

      await this.outboxService.record(tx, {
        id: newId(),
        type: "identity.member_invited.v1",
        version: 1,
        occurredAt: now,
        aggregateType: "Invitation",
        aggregateId: invitationId,
        organizationId,
        payload: {
          invitationId,
          organizationId,
          organizationName: organization.name,
          email: input.email,
          role: input.role,
          invitedByUserId,
          token,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return {
        id: invitationId,
        organizationId,
        email: input.email,
        role: input.role,
        parkingLotIds: [],
        expiresAt,
        createdAt: now,
      };
    });
  }
}
