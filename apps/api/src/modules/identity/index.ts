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
 */
export { IdentityModule } from "./identity.module";
export {
  DEMO_ORGANIZATION_CNPJ,
  DEMO_SEED_EMAILS,
  DEMO_SEED_PASSWORD,
  seedIdentity,
} from "./infra/seed";
