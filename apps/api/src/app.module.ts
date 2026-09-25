import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

import { LoggingModule } from "./common/logging.module";
import { ProblemDetailsExceptionFilter } from "./common/problem-details.exception-filter";
import { AppConfigModule } from "./config/app-config.module";
import { HealthModule } from "./health/health.module";

/**
 * Root module (ULTRAPLAN 0.3). No domain modules yet (`modules/<ctx>` — identity,
 * facilities, sessions, ... — start in Phase 1+); this is only the bootstrap skeleton
 * shared by both entrypoints (main.ts / main.worker.ts, see docs/adr/0001).
 */
@Module({
  imports: [AppConfigModule, LoggingModule, HealthModule],
  providers: [
    // Every future controller DTO is a Zod schema (`nestjs-zod`, see
    // docs/architecture/api-and-events.md) — validated globally here.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // RFC 9457 `application/problem+json` for every unhandled exception.
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
  ],
})
export class AppModule {}
