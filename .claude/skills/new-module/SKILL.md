---
name: new-module
description: Scaffold a new bounded-context module in apps/api following the project's layered layout (domain/application/infra/http/events + index.ts), wired into the Nest app and the boundaries lint rule. Use when a ULTRAPLAN task introduces a module that doesn't exist yet.
---

# /new-module

Argument: module name in kebab-case (e.g. `reservations`).

1. Confirm the module is listed in `docs/architecture/system-design.md` §6. If not, stop and consult `architect`.
2. Create:
   ```
   apps/api/src/modules/<name>/
     index.ts                 # export only the Nest module class and public service/types
     <name>.module.ts
     domain/.gitkeep
     application/.gitkeep
     infra/schema.ts          # Drizzle tables for this module (empty export if none yet)
     http/.gitkeep
     events/.gitkeep
   apps/api/test/<name>/      # integration tests
   packages/contracts/src/<name>/index.ts   # Zod schemas for this context, re-exported from the package root
   ```
3. Register the module in `apps/api/src/app.module.ts` and its schema in the Drizzle schema index.
4. Add the module to the boundaries lint config so only `modules/<name>/index.ts` is importable from outside.
5. Run `pnpm lint && pnpm typecheck` to confirm the wiring.
