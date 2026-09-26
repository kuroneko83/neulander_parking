import type { GlobalRole, OrganizationRole } from "@neulander/contracts";

/**
 * Access token claims (ADR-0004: "access JWT RS256 (15 min) com `sub`, `roles` globais e
 * lista curta de orgs"). Pure shape — no Nest/`jsonwebtoken` import here, `domain/` stays
 * framework-free (CLAUDE.md rule 2); `infra/jwt-token.service.ts` is the only place that
 * actually signs/serializes this into a JWT.
 *
 * Decision (ADR-0004 doesn't pin the exact wire shape of "roles"/"lista curta de orgs",
 * only ULTRAPLAN 1.3's own task text does): two separate claims, not one merged list —
 * - `roleGlobal`: `users.role_global` (data-model.md) — a role that applies platform-wide,
 *   independent of any organization (`driver`/`platform_admin`), or `null` when the user
 *   has none (the common case for owners/managers/operators, see
 *   `packages/contracts/src/identity.ts`'s own comment on this column).
 * - `roles`: one entry per `memberships` row the user holds — "lista curta" because a real
 *   user in this domain belongs to a small, bounded number of organizations (they run/work
 *   at specific parking lots, not thousands), so embedding it directly in the token avoids
 *   a `memberships` lookup on every authenticated request once `JwtAuthGuard`/`OrgScopeGuard`
 *   land (ULTRAPLAN 1.4) — the guard/`OrgScopeGuard` reads this claim instead of hitting the
 *   database to check "is this user a member of `:orgId`, and with which role".
 *
 * Kept as two fields instead of unioning into one list mirrors why
 * `GlobalRoleSchema`/`OrganizationRoleSchema` are two separate contracts in the first
 * place (see that file's own comment): they're different concepts with different
 * cardinality (0-or-1 global role vs. 0-or-many org memberships), and merging them would
 * only make a consumer's code guess which kind of entry it's looking at.
 */
export interface AccessTokenClaims {
  /** `sub` — the user's id (`users.id`). */
  sub: string;
  roleGlobal: GlobalRole | null;
  roles: { organizationId: string; role: OrganizationRole }[];
}
