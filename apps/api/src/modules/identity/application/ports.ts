import type { GlobalRole, OrganizationRole } from "@neulander/contracts";

import type { Database } from "../../../database/database.module";
import type { AccessTokenClaims } from "../domain/access-token-claims";

/**
 * Ports (interfaces + DI tokens) for everything `application/`'s use cases need from
 * `infra/` — declared here, not in `domain/`, specifically because these signatures take
 * `Database` (a Drizzle-typed transaction handle), and `domain/` must stay Drizzle-free
 * (CLAUDE.md rule 2). `application/` has no such purity requirement — it already depends
 * on `Database`/`DATABASE_CONNECTION` directly to open its own transactions (see e.g.
 * `RegisterUserUseCase`), so a port method threading that same handle through to a
 * same-module `infra/` adapter is nothing new.
 *
 * This is the concrete mechanism `eslint.boundaries.mjs`'s own error message describes:
 * "`application/` só depende de `domain/` — ... Declare a porta (interface + token de DI)
 * em `domain/`/`application/` e injete o adapter de `infra/` pelo módulo Nest." Every
 * `infra/*.ts` class in this module `implements` one of the interfaces below;
 * `identity.module.ts` is the only place that imports both sides and wires
 * `{ provide: TOKEN, useClass: ConcreteInfraAdapter }`.
 */

// --- users ---

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  roleGlobal: GlobalRole | null;
}

export interface InsertUserInput {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string | undefined;
  roleGlobal?: GlobalRole;
}

export const USERS_REPOSITORY = Symbol("USERS_REPOSITORY");

export interface UsersRepositoryPort {
  /** Throws `EmailAlreadyRegisteredError` (domain) on a `users.email` unique violation —
   * never lets the raw Postgres `23505` escape to a caller. */
  insert(db: Database, input: InsertUserInput): Promise<void>;
  /** Case-insensitive by construction — `users.email` is `citext` (data-model.md). */
  findByEmail(db: Database, email: string): Promise<UserRecord | undefined>;
  findById(db: Database, id: string): Promise<UserRecord | undefined>;
}

// --- memberships ---

export interface MembershipRecord {
  organizationId: string;
  role: OrganizationRole;
  parkingLotIds: string[];
}

export const MEMBERSHIPS_REPOSITORY = Symbol("MEMBERSHIPS_REPOSITORY");

export interface MembershipsRepositoryPort {
  findByUserId(db: Database, userId: string): Promise<MembershipRecord[]>;
}

// --- refresh tokens ---

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export interface InsertRefreshTokenInput {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export const REFRESH_TOKENS_REPOSITORY = Symbol("REFRESH_TOKENS_REPOSITORY");

export interface RefreshTokensRepositoryPort {
  insert(db: Database, input: InsertRefreshTokenInput): Promise<void>;
  /** `SELECT ... FOR UPDATE` under the hood — callers MUST invoke this inside a
   * `db.transaction()` (the row lock is only meaningful for the transaction's lifetime),
   * so two concurrent refresh requests presenting the same token can't both observe it as
   * "not yet rotated". */
  findByTokenHashForUpdate(
    db: Database,
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined>;
  /** Plain (no `FOR UPDATE`) lookup — for `LogoutUseCase` (ULTRAPLAN 1.4), which only reads
   * `userId`/`familyId` to authorize and target a `revokeFamily` call. Logout isn't part of
   * the rotation race `findByTokenHashForUpdate`'s lock protects against (there's no
   * "insert the replacement" step to race), so taking that lock here would only hold a row
   * lock for no reason. */
  findByTokenHash(db: Database, tokenHash: string): Promise<RefreshTokenRecord | undefined>;
  revoke(db: Database, id: string, revokedAt: Date, replacedBy: string): Promise<void>;
  /** Revokes every not-yet-revoked token sharing `familyId` — ADR-0004's reuse response.
   * Rows already revoked (e.g. by a prior legitimate rotation) keep their original
   * `revoked_at`/`replaced_by` untouched; only the still-"live" tail of the chain (which,
   * in the reuse scenario, is exactly the token an attacker hasn't presented yet) gets
   * revoked here. */
  revokeFamily(db: Database, familyId: string, revokedAt: Date): Promise<void>;
}

// --- password hashing ---

export const PASSWORD_HASHER = Symbol("PASSWORD_HASHER");

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

// --- access token signing/verification ---

export const ACCESS_TOKEN_SERVICE = Symbol("ACCESS_TOKEN_SERVICE");

export interface AccessTokenServicePort {
  sign(claims: AccessTokenClaims): string;
  /** Verifies signature (RS256, pinned explicitly — never trusts the token's own `alg`
   * header) and expiry, returning the decoded claims. Throws (`jsonwebtoken`'s
   * `JsonWebTokenError`/`TokenExpiredError`) on any invalid/expired/malformed token —
   * `JwtAuthGuard` (ULTRAPLAN 1.4) is the only caller and translates any throw into a
   * generic `401 UNAUTHORIZED`, never distinguishing the reason to the client. */
  verify(token: string): AccessTokenClaims;
}
