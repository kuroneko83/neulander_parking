import { Injectable } from "@nestjs/common";
import type { OrganizationRole } from "@neulander/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type {
  InsertMembershipInput,
  MembershipRecord,
  MembershipsRepositoryPort,
} from "../application/ports";
import { MemberAlreadyExistsError } from "../domain/invitation-errors";
import { memberships } from "./schema";

const UNIQUE_VIOLATION = "23505";

/** Mirrors `users.repository.ts`'s own `isUniqueViolation()` — see
 * `invitations.repository.ts`'s identical helper for why this isn't factored into one
 * shared function. */
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

@Injectable()
export class MembershipsRepository implements MembershipsRepositoryPort {
  async findByUserId(db: Database, userId: string): Promise<MembershipRecord[]> {
    const rows = await db
      .select({
        organizationId: memberships.organizationId,
        role: memberships.role,
        parkingLotIds: memberships.parkingLotIds,
      })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    return rows.map((row) => ({
      organizationId: row.organizationId,
      role: row.role as OrganizationRole,
      parkingLotIds: row.parkingLotIds,
    }));
  }

  async insert(db: Database, input: InsertMembershipInput): Promise<void> {
    try {
      await db.insert(memberships).values({
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        parkingLotIds: input.parkingLotIds,
      });
    } catch (error) {
      // Security/code-review fix (ULTRAPLAN 1.5): `AcceptInvitationUseCase` calls this
      // after locking the invitation row `FOR UPDATE`, but nothing stops a completely
      // separate flow (or a second accept racing on a DIFFERENT invitation to the same
      // org/e-mail) from concurrently inserting the same `memberships` row — this insert,
      // guarded by `memberships_organization_id_user_id_unique` (data-model.md), is the
      // real, atomic backstop. Translating the raw unique violation into
      // `MemberAlreadyExistsError` here avoids the same two problems
      // `InvitationsRepository.insert()`'s identical fix documents: a generic `500`
      // instead of a meaningful `409`, and a raw `DrizzleQueryError` (bound params include
      // the new user's id) reaching the exception filter's error log.
      if (isUniqueViolation(error)) {
        throw new MemberAlreadyExistsError();
      }
      throw error;
    }
  }

  async existsForOrganizationAndUser(
    db: Database,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
    return row !== undefined;
  }
}
