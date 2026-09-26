import { Injectable } from "@nestjs/common";
import type { GlobalRole } from "@neulander/contracts";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../../database/database.module";
import type { InsertUserInput, UserRecord, UsersRepositoryPort } from "../application/ports";
import { EmailAlreadyRegisteredError } from "../domain/auth-errors";
import { users } from "./schema";

const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the raw `pg` `DatabaseError` in its own `DrizzleQueryError`, whose real
 * SQLSTATE lives at `.cause.code` — same shape `test/identity/schema.int.test.ts` already
 * asserts against for this table's constraints. */
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
export class UsersRepository implements UsersRepositoryPort {
  async insert(db: Database, input: InsertUserInput): Promise<void> {
    try {
      await db.insert(users).values({
        id: input.id,
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
        phone: input.phone,
        roleGlobal: input.roleGlobal,
      });
    } catch (error) {
      // `users_email_unique` is the only unique constraint this insert can hit (id is a
      // freshly generated UUID v7, never a duplicate) — translate it to the domain error
      // without leaking the raw Postgres exception (CLAUDE.md: never let a cru Postgres
      // error escape a use case).
      if (isUniqueViolation(error)) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  // `isNull(deletedAt)` on both lookups: no flow writes `deleted_at` yet (it's a soft-delete
  // marker with no deactivation feature built on it today — data-model.md), but every
  // auth-relevant read excluding it now, while it's free, means the day a deactivation
  // feature lands, a soft-deleted user is denied login/refresh automatically instead of
  // that being a bug someone has to notice and fix in this repository later.
  async findByEmail(db: Database, email: string): Promise<UserRecord | undefined> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)));
    return row ? this.toRecord(row) : undefined;
  }

  async findById(db: Database, id: string): Promise<UserRecord | undefined> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return row ? this.toRecord(row) : undefined;
  }

  private toRecord(row: typeof users.$inferSelect): UserRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      phone: row.phone,
      roleGlobal: row.roleGlobal as GlobalRole | null,
    };
  }
}
