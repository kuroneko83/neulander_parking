import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type {
  InsertRefreshTokenInput,
  RefreshTokenRecord,
  RefreshTokensRepositoryPort,
} from "../application/ports";
import { refreshTokens } from "./schema";

@Injectable()
export class RefreshTokensRepository implements RefreshTokensRepositoryPort {
  async insert(db: Database, input: InsertRefreshTokenInput): Promise<void> {
    await db.insert(refreshTokens).values({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
    });
  }

  async findByTokenHashForUpdate(
    db: Database,
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .for("update");
    return row;
  }

  async findByTokenHash(db: Database, tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    return row;
  }

  async revoke(db: Database, id: string, revokedAt: Date, replacedBy: string): Promise<void> {
    await db.update(refreshTokens).set({ revokedAt, replacedBy }).where(eq(refreshTokens.id, id));
  }

  async revokeFamily(db: Database, familyId: string, revokedAt: Date): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
