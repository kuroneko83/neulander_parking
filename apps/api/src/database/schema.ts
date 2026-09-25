/**
 * Drizzle schema barrel (ULTRAPLAN 0.4). `drizzle.config.ts` points `schema` here so
 * `drizzle-kit generate` has one place to read every table definition from.
 *
 * Empty for now: no domain module exists yet (`modules/identity`, `modules/facilities`,
 * ... start in Phase 1+ — see docs/ULTRAPLAN.md). Per CLAUDE.md/data-model.md, each
 * table belongs to the module that owns it and its Drizzle definition lives in that
 * module's own `infra/schema.ts` (e.g. `modules/identity/infra/schema.ts`) — this file
 * only re-exports them so drizzle-kit sees the union of every module's tables:
 *
 *   export * from "../modules/identity/infra/schema";
 *   export * from "../modules/facilities/infra/schema";
 *   ...
 *
 * Add one re-export line here the day each module's schema is created — never define
 * tables directly in this file.
 */
export {};
