import { Module } from "@nestjs/common";

/**
 * Wiring for the `identity` module (ULTRAPLAN 1.2). Deliberately empty for now — this task
 * only creates the module's tables (`infra/schema.ts`) and the module's place in the app;
 * no repository/use case/controller exists yet (`domain/`/`application/`/`http/` are still
 * empty — that's ULTRAPLAN 1.3 registration/login, 1.4 guards). Registered in
 * `app.module.ts` today so those tasks only ever add providers/controllers here, never wire
 * the module itself for the first time.
 *
 * Not `@Global()` (unlike `SharedModule`): nothing outside this module needs anything from
 * it yet. That decision is revisited once 1.3 adds a public service other modules might
 * inject (e.g. "look up a user by id").
 */
@Module({})
export class IdentityModule {}
