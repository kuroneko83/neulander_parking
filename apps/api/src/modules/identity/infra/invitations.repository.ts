import { Injectable } from "@nestjs/common";
import type { OrganizationRole } from "@neulander/contracts";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type {
  InsertInvitationInput,
  InvitationRecord,
  InvitationsRepositoryPort,
} from "../application/ports";
import { InvitationAlreadyPendingError } from "../domain/invitation-errors";
import { invitations } from "./schema";

const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the raw `pg` `DatabaseError` in its own `DrizzleQueryError`, whose real
 * SQLSTATE lives at `.cause.code` — same pattern as `users.repository.ts`'s own
 * `isUniqueViolation()` (mirrored here, not imported, for the same reason that file isn't a
 * shared helper module: each repository's `insert()` translates a DIFFERENT constraint to a
 * DIFFERENT domain error, so there's nothing generic to actually share beyond this check). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof (error as { cause?: unknown }).cause === "object" &&
    error.cause !== null &&
    (error as { cause: { code?: unknown } }).cause.code === UNIQUE_VIOLATION
  );
}

function toRecord(row: typeof invitations.$inferSelect): InvitationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role as OrganizationRole,
    parkingLotIds: row.parkingLotIds,
    tokenHash: row.tokenHash,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class InvitationsRepository implements InvitationsRepositoryPort {
  async insert(db: Database, input: InsertInvitationInput): Promise<void> {
    try {
      await db.insert(invitations).values({
        id: input.id,
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        parkingLotIds: input.parkingLotIds,
        tokenHash: input.tokenHash,
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      });
    } catch (error) {
      // Security/code-review fix (ULTRAPLAN 1.5): `InviteMemberUseCase`'s own
      // `findPendingByOrganizationAndEmail` pre-check runs under READ COMMITTED, so two
      // concurrent invites for the same e-mail (e.g. a double-click on "convidar") can both
      // pass that SELECT before either commits — `invitations_org_email_pending_unique`
      // (data-model.md) is the real, atomic guarantee, and this insert is the only place
      // that constraint can actually fire. Translating it here (instead of letting a raw
      // `DrizzleQueryError` escape) fixes two problems at once: the caller gets the
      // intended `409 INVITATION_ALREADY_PENDING` instead of a generic `500`, AND nothing
      // resembling the invitee's e-mail/token ever reaches
      // `ProblemDetailsExceptionFilter`'s `logger.error({ err: exception }, ...)` — a raw
      // Postgres unique-violation error's `.cause`/`.message` embeds the bound SQL
      // parameters (CLAUDE.md rule 10: never log e-mail/token in the clear).
      // `invitations_token_hash_unique` could theoretically also fire here, but a 256-bit
      // random collision is negligible enough that treating it the same way (like
      // `UsersRepository.insert()` does for its own single unique constraint) is the right
      // trade-off over adding constraint-name inspection for a practically-unreachable case.
      if (isUniqueViolation(error)) {
        throw new InvitationAlreadyPendingError();
      }
      throw error;
    }
  }

  async findPendingByOrganizationAndEmail(
    db: Database,
    organizationId: string,
    email: string,
  ): Promise<InvitationRecord | undefined> {
    const [row] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    return row ? toRecord(row) : undefined;
  }

  async findByTokenHash(db: Database, tokenHash: string): Promise<InvitationRecord | undefined> {
    const [row] = await db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash));
    return row ? toRecord(row) : undefined;
  }

  async findByTokenHashForUpdate(
    db: Database,
    tokenHash: string,
  ): Promise<InvitationRecord | undefined> {
    const [row] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash))
      .for("update");
    return row ? toRecord(row) : undefined;
  }

  async markAccepted(
    db: Database,
    id: string,
    acceptedAt: Date,
    acceptedByUserId: string,
  ): Promise<void> {
    await db.update(invitations).set({ acceptedAt, acceptedByUserId }).where(eq(invitations.id, id));
  }
}
