import type { OrganizationRole } from "@neulander/contracts";

/**
 * Role-escalation rule for `POST /v1/orgs/:orgId/members` (ULTRAPLAN 1.5): "manager não pode
 * convidar owner" (api-and-events.md). Only an `owner` may invite another `owner`; a
 * `manager` may invite a `manager` or an `operator`.
 *
 * Pure decision table — no DB/HTTP concern — so it lives in `domain/` and is exhaustively
 * unit-tested (all 3×3 role combinations) rather than only exercised indirectly through
 * `InviteMemberUseCase`'s integration tests.
 *
 * `callerRole === "operator"` always returns `false`: this is defense in depth, not the
 * primary enforcement — `RolesGuard`'s `@Roles("owner", "manager")` on the controller
 * already keeps an `operator` from reaching this function at all (api-and-events.md: "owner,
 * manager" is who may call the endpoint). If that guard configuration were ever weakened,
 * this function still refuses to authorize an operator-issued invitation of any role.
 */
export function canInviteRole(callerRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  if (callerRole === "operator") {
    return false;
  }
  if (targetRole === "owner") {
    return callerRole === "owner";
  }
  return true;
}
