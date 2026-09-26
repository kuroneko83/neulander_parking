import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type { OrganizationRecord, OrganizationsRepositoryPort } from "../application/ports";
import { organizations } from "./schema";

@Injectable()
export class OrganizationsRepository implements OrganizationsRepositoryPort {
  async findById(db: Database, id: string): Promise<OrganizationRecord | undefined> {
    const [row] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, id));
    return row;
  }
}
