import { SetMetadata } from "@nestjs/common";
import type { GlobalRole, OrganizationRole } from "@neulander/contracts";

export const ROLES_KEY = "roles";

/**
 * `@Roles(...)` (ULTRAPLAN 1.4) — marks a controller/handler with the roles allowed to call
 * it; `RolesGuard` reads this metadata and denies anything else. Takes the literal,
 * explicit set of satisfying roles rather than a single role plus an implied hierarchy
 * (`api-and-events.md`'s own "manager+"/"operator+" notation is just informal shorthand for
 * that set) — e.g. a "manager+" route is `@Roles("owner", "manager")`, an "operator+" route
 * is `@Roles("owner", "manager", "operator")`. Spelling out the set at each call site costs
 * one or two extra words and avoids baking a specific role-ordering assumption into the
 * guard that every future route would silently depend on.
 *
 * Accepts either kind of role (`GlobalRole` for `platform_admin`-only routes, or
 * `OrganizationRole` for the org-scoped routes `OrgScopeGuard` protects) since `RolesGuard`
 * checks both `request.user.roleGlobal` and `request.membership?.role` against the same
 * list — a route needs only one `@Roles()` call regardless of which kind of role satisfies
 * it.
 */
export const Roles = (...roles: (GlobalRole | OrganizationRole)[]) => SetMetadata(ROLES_KEY, roles);
