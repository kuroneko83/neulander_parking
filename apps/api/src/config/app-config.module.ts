import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppConfigService } from "./app-config.service";
import { validateEnv } from "./env.schema";

/**
 * Global config module (ULTRAPLAN 0.3): validates `process.env` with Zod once at
 * bootstrap (`validateEnv`) and exposes the typed `AppConfigService` everywhere.
 *
 * `ignoreEnvFile: true` — we load the monorepo-root `.env` ourselves via
 * `loadRootEnvFile()` (called from main.ts/main.worker.ts/test setup) before Nest
 * boots, so `process.env` is already populated by the time this module validates it.
 * Letting `@nestjs/config` also search for a `.env` (relative to `cwd`, which Turbo
 * sets to the package dir) would just be a second, possibly-divergent source of truth.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
