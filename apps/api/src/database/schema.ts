/**
 * Drizzle schema barrel (ULTRAPLAN 0.4). `drizzle.config.ts` points `schema` here so
 * `drizzle-kit generate` has one place to read every table definition from.
 *
 * Per CLAUDE.md/data-model.md, each table belongs to the module that owns it and its
 * Drizzle definition lives in that module's own `infra/schema.ts` — this file only
 * re-exports them so drizzle-kit sees the union of every module's tables. This barrel is
 * tooling plumbing for `drizzle-kit`/`db:migrate` only; application code never imports
 * from it — it goes through each module's own public `index.ts` instead (CLAUDE.md rule
 * 1), same as `modules/shared/index.ts` documents for its own `infra/schema.ts`.
 *
 * `modules/identity`, `modules/facilities`, ... add their own re-export line here as they
 * land (Phase 1+ — see docs/ULTRAPLAN.md). Never define tables directly in this file.
 */
export * from "../modules/shared/infra/schema";
