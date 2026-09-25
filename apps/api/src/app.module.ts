import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

import { LoggingModule } from "./common/logging.module";
import { ProblemDetailsExceptionFilter } from "./common/problem-details.exception-filter";
import { AppConfigModule } from "./config/app-config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { SharedModule } from "./modules/shared";

/**
 * Root module (ULTRAPLAN 0.3/0.4/0.5, `shared` kernel added). No domain modules yet (`modules/<ctx>` — identity,
 * facilities, sessions, ... — start in Phase 1+); this is only the bootstrap skeleton
 * shared by both entrypoints (main.ts / main.worker.ts, see docs/adr/0001), plus the
 * shared Drizzle/Postgres client (DatabaseModule) they'll inject into, plus the `shared`
 * kernel (`SharedModule` — Clock, OutboxService, BullMQ) every future domain module
 * builds on.
 *
 * `SharedModule` registers `OutboxRelayProcessor` as a provider in both entrypoints, but
 * its polling only ever starts when `main.worker.ts` explicitly calls `.start()` after
 * bootstrap completes — see that file and the processor's own doc comment for why.
 */
@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, SharedModule, HealthModule],
  providers: [
    // Every future controller DTO is a Zod schema (`nestjs-zod`, see
    // docs/architecture/api-and-events.md) — validated globally here.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // RFC 9457 `application/problem+json` for every unhandled exception.
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
  ],
})
export class AppModule {}
