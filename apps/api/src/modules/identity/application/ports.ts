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

export interface InsertMembershipInput {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  parkingLotIds: string[];
}

export const MEMBERSHIPS_REPOSITORY = Symbol("MEMBERSHIPS_REPOSITORY");

export interface MembershipsRepositoryPort {
  findByUserId(db: Database, userId: string): Promise<MembershipRecord[]>;
  /** `AcceptInvitationUseCase`'s only write (ULTRAPLAN 1.5) — both the "brand-new user" and
   * "existing user" branches end here. Relies on `memberships_organization_id_user_id_unique`
   * (data-model.md) as a last-resort safety net, same as `UsersRepository.insert` does for
   * `users.email` — nothing pre-checks this before calling it, since
   * `InviteMemberUseCase.execute()` already rejects inviting someone who's already a member
   * (`MemberAlreadyExistsError`) before an invitation (and therefore a later `accept`) can
   * even exist for that pair. */
  insert(db: Database, input: InsertMembershipInput): Promise<void>;
  /** `InviteMemberUseCase`'s existing-member check (ULTRAPLAN 1.5: "existing-member check
   * (409 MEMBER_ALREADY_EXISTS)") — only meaningful when the invited e-mail already has a
   * `users` row; a brand-new e-mail can't possibly already be a member. */
  existsForOrganizationAndUser(db: Database, organizationId: string, userId: string): Promise<boolean>;
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

// --- organizations ---

export interface OrganizationRecord {
  id: string;
  name: string;
}

export const ORGANIZATIONS_REPOSITORY = Symbol("ORGANIZATIONS_REPOSITORY");

/** Read-only on purpose (ULTRAPLAN 1.5): nothing in this task creates/edits an organization
 * — `InviteMemberUseCase`/`GetInvitationUseCase` only need the org's `name`, to put in
 * `identity.member_invited.v1`'s payload and `InvitationPreviewSchema.organizationName`
 * respectively. `POST /v1/orgs` (platform_admin, ULTRAPLAN 1.1's own table) writes
 * `organizations` directly today with no repository at all — this port doesn't change that,
 * it only adds the first READ this module needed. */
export interface OrganizationsRepositoryPort {
  findById(db: Database, id: string): Promise<OrganizationRecord | undefined>;
}

// --- invitations ---

export interface InvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  parkingLotIds: string[];
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
}

export interface InsertInvitationInput {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  parkingLotIds: string[];
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}

export const INVITATIONS_REPOSITORY = Symbol("INVITATIONS_REPOSITORY");

export interface InvitationsRepositoryPort {
  insert(db: Database, input: InsertInvitationInput): Promise<void>;
  /** `InviteMemberUseCase`'s duplicate-pending-invite check — scoped to `accepted_at IS
   * NULL AND revoked_at IS NULL`, mirroring `invitations_org_email_pending_unique`
   * (data-model.md) exactly, so this read and that constraint always agree on what "still
   * pending" means. */
  findPendingByOrganizationAndEmail(
    db: Database,
    organizationId: string,
    email: string,
  ): Promise<InvitationRecord | undefined>;
  /** Plain (no `FOR UPDATE`) lookup — `GetInvitationUseCase`'s public preview only reads,
   * never mutates, so it doesn't need `AcceptInvitationUseCase`'s row lock. */
  findByTokenHash(db: Database, tokenHash: string): Promise<InvitationRecord | undefined>;
  /** `SELECT ... FOR UPDATE` under the hood — same reasoning as
   * `RefreshTokensRepositoryPort.findByTokenHashForUpdate` (ULTRAPLAN 1.3): two concurrent
   * accept requests presenting the same token can't both observe it as "not yet accepted". */
  findByTokenHashForUpdate(db: Database, tokenHash: string): Promise<InvitationRecord | undefined>;
  markAccepted(db: Database, id: string, acceptedAt: Date, acceptedByUserId: string): Promise<void>;
}
