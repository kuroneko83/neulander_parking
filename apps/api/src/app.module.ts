import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

import { LoggingModule } from "./common/logging.module";
import { ProblemDetailsExceptionFilter } from "./common/problem-details.exception-filter";
import { AppConfigModule } from "./config/app-config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./modules/identity";
import { NotificationsModule } from "./modules/notifications";
import { IdentifierFailureThrottleInterceptor, LoggingThrottlerGuard, SharedModule } from "./modules/shared";

/**
 * Root module (ULTRAPLAN 0.3/0.4/0.5, `shared` kernel added; ULTRAPLAN 1.2 adds the first
 * domain module, `identity`). This is the bootstrap skeleton shared by both entrypoints
 * (main.ts / main.worker.ts, see docs/adr/0001), plus the shared Drizzle/Postgres client
 * (DatabaseModule) they'll inject into, plus the `shared` kernel (`SharedModule` — Clock,
 * OutboxService, BullMQ) every domain module builds on. Future domain modules
 * (`facilities`, `sessions`, ... — Phase 2+) each add their own import line here as they
 * land, same as `IdentityModule` does now.
 *
 * `SharedModule` registers `OutboxRelayProcessor` as a provider in both entrypoints, but
 * its polling only ever starts when `main.worker.ts` explicitly calls `.start()` after
 * bootstrap completes — see that file and the processor's own doc comment for why.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    SharedModule,
    HealthModule,
    IdentityModule,
    NotificationsModule,
  ],
  providers: [
    // Every future controller DTO is a Zod schema (`nestjs-zod`, see
    // docs/architecture/api-and-events.md) — validated globally here.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // RFC 9457 `application/problem+json` for every unhandled exception.
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
    // ULTRAPLAN 1.6 security-review fix (nit #8): global rate-limit safety net — every
    // route in the app is protected by the generous `default` tier even if a future
    // controller forgets to opt into `strictIp`/`moderateIp` via `@Throttle()`.
    // `LoggingThrottlerGuard` (not the bare `@nestjs/throttler` `ThrottlerGuard` — security-
    // review fix nit: "no log line when a limit is exceeded") is a thin subclass that only
    // adds a masked `warn` log line whenever it actually blocks a request — see that class'
    // own doc comment. `useExisting` (not `useClass`): reuses the EXACT SAME instance
    // `SharedModule` already provides/exports instead of constructing a redundant second one.
    { provide: APP_GUARD, useExisting: LoggingThrottlerGuard },
    { provide: APP_INTERCEPTOR, useExisting: IdentifierFailureThrottleInterceptor },
  ],
})
export class AppModule {}
