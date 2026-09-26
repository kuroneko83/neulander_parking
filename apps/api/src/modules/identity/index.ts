/**
 * Public API of the `identity` module (ULTRAPLAN 1.2, CLAUDE.md rule 1: "Cada módulo da API
 * expõe apenas seu `index.ts`"). Every other module/bootstrap file imports from
 * `modules/identity` — never from `modules/identity/domain/...` or
 * `modules/identity/infra/...` directly.
 *
 * `infra/schema.ts`'s tables (`users`, `organizations`, `memberships`, `refreshTokens`) are
 * deliberately NOT re-exported here, same reasoning as `modules/shared/index.ts` documents
 * for its own tables: only this module's own repositories query them, per CLAUDE.md rule 2
 * ("código de um módulo não faz JOIN em tabela de outro"). `apps/api/src/database/schema.ts`
 * still re-exports them directly from `infra/schema.ts` (bypassing this barrel), but that
 * exists purely for `drizzle-kit` tooling, not for application code to import from.
 *
 * `seedIdentity`/`DEMO_SEED_PASSWORD` ARE exported (unlike the tables) because
 * `apps/api/src/database/seed.ts` — bootstrap/tooling, not a domain module — needs to call
 * the former, and `apps/api/test/identity/seed.int.test.ts` the latter, both from outside
 * this module; the boundaries rule only requires going through this barrel, not that this
 * barrel export nothing infra-shaped.
 *
 * The `http/guards/*` exports (ULTRAPLAN 1.4) are this module's main public surface for
 * every OTHER module: `JwtAuthGuard`/`RolesGuard`/`OrgScopeGuard`/`@Roles()` are how a
 * future module (facilities, sessions, payments, ...) protects its own controllers
 * (`@UseGuards(JwtAuthGuard, OrgScopeGuard, RolesGuard) @Roles("owner", "manager")`) without
 * ever importing `modules/identity/http/guards/*` directly — `IdentityModule` is `@Global()`
 * so these three guard classes resolve via Nest DI from anywhere once this barrel exports
 * them. `AuthenticatedRequest`/`MembershipClaim` are exported alongside them purely as
 * TYPES, for a consuming controller to type its own `@Req() req: AuthenticatedRequest`.
 */
export type { AuthenticatedRequest, MembershipClaim } from "./http/guards/authenticated-request";
export { JwtAuthGuard } from "./http/guards/jwt-auth.guard";
export { OrgScopeGuard } from "./http/guards/org-scope.guard";
export { Roles } from "./http/guards/roles.decorator";
export { RolesGuard } from "./http/guards/roles.guard";
export { IdentityModule } from "./identity.module";
export {
  DEMO_ORGANIZATION_CNPJ,
  DEMO_SEED_EMAILS,
  DEMO_SEED_PASSWORD,
  seedIdentity,
} from "./infra/seed";
