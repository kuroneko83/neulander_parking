import { Injectable } from "@nestjs/common";
import type { OrganizationRole } from "@neulander/contracts";
import { eq } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type { MembershipRecord, MembershipsRepositoryPort } from "../application/ports";
import { memberships } from "./schema";

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
}
