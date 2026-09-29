import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AppConfigModule } from "../../config/app-config.module";
import { AppConfigService } from "../../config/app-config.service";
import { DatabaseModule } from "../../database/database.module";
import { DomainEventBus } from "./infra/domain-events.bus";
import { DomainEventsProcessor } from "./infra/domain-events.processor";
import { IdempotencyInterceptor } from "./infra/idempotency.interceptor";
import { IdentifierFailureThrottleInterceptor } from "./infra/identifier-failure-throttle.interceptor";
import { LoggingThrottlerGuard } from "./infra/logging-throttler.guard";
import { OutboxService } from "./infra/outbox.service";
import { DOMAIN_EVENTS_QUEUE, OutboxRelayProcessor } from "./infra/outbox-relay.processor";
import { buildThrottlerModuleOptions } from "./infra/rate-limit.config";
import { RedisThrottlerStorage } from "./infra/redis-throttler-storage";
import { CLOCK, SystemClock } from "./infra/system-clock";

/**
 * Wiring for the `shared` kernel (ULTRAPLAN 0.5). `@Global()` — same reasoning as
 * `DatabaseModule`/`AppConfigModule`: every future domain module needs `CLOCK` and
 * `OutboxService`, and re-importing this in each of them would just be boilerplate.
 * Imported once from `AppModule`.
 *
 * BullMQ connection is configured here, once, for the whole app (`BullModule.forRootAsync`)
 * — future domain modules that need their *own* queues call `BullModule.registerQueue()`
 * in their own module without repeating connection config, same pattern the Nest/BullMQ
 * docs recommend. `maxRetriesPerRequest: null` is required by BullMQ's blocking commands
 * (used by `Worker`/`QueueEvents`, not yet present here, but any future consumer sharing
 * this connection needs it set from the start).
 *
 * Only one queue exists for now (`DOMAIN_EVENTS_QUEUE`, registered here) — ULTRAPLAN 0.5
 * decision: "fila única por enquanto", no per-module routing yet.
 *
 * `ThrottlerModule.forRootAsync` (ULTRAPLAN 1.6, `infra/rate-limit.config.ts`): backed by
 * `RedisThrottlerStorage` (`infra/redis-throttler-storage.ts`), NOT the package's default
 * in-memory storage — this API runs as multiple ECS Fargate tasks behind a load balancer
 * (system-design.md §5/§11), and in-memory storage would let each task track its own
 * counter, multiplying the effective limit by instance count.
 *
 * `LoggingThrottlerGuard`/`IdentifierFailureThrottleInterceptor` are exported here but
 * registered as `APP_GUARD`/`APP_INTERCEPTOR` in `app.module.ts` (security-review fix, nit
 * #8) — NOT applied per-controller via `@UseGuards()`/`@UseInterceptors()` — so every route
 * in the app is protected by the generous `default` tier even if a future controller
 * forgets to opt in explicitly; see `rate-limit.config.ts`'s own doc comment for the full
 * tier breakdown. `app.module.ts` reuses this exact instance via `useExisting` (not
 * `useClass`, which would construct a SECOND, redundant instance) — that's why it's exported
 * here at all, despite `app.module.ts` never calling `@UseGuards(LoggingThrottlerGuard)`
 * directly anymore. `LoggingThrottlerGuard` (`infra/logging-throttler.guard.ts`, security-
 * review fix nit: "no log line when a limit is exceeded") is a thin `ThrottlerGuard`
 * subclass that only adds a masked `warn` log on block — plain `ThrottlerGuard` is ALSO
 * still provided/exported here (unchanged), since `test/identity/rate-limit.int.test.ts`'s
 * throwaway probe controller wires it directly via `@UseGuards(ThrottlerGuard)` against its
 * own isolated test module, independent of the app-wide `APP_GUARD` registration.
 * `@Throttle()`/`@SkipThrottle()` (used per-route to override the `strictIp`/`moderateIp`
 * tiers' otherwise-inert base limits) are NOT re-exported — a controller imports those two
 * directly from `@nestjs/throttler`, a third-party lib import like any other.
 */
@Global()
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        connection: { url: appConfig.redisUrl, maxRetriesPerRequest: null },
      }),
    }),
    BullModule.registerQueue({ name: DOMAIN_EVENTS_QUEUE }),
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService, RedisThrottlerStorage],
      useFactory: buildThrottlerModuleOptions,
    }),
  ],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    OutboxService,
    OutboxRelayProcessor,
    IdempotencyInterceptor,
    DomainEventBus,
    DomainEventsProcessor,
    RedisThrottlerStorage,
    ThrottlerGuard,
    LoggingThrottlerGuard,
    IdentifierFailureThrottleInterceptor,
  ],
  exports: [
    CLOCK,
    OutboxService,
    OutboxRelayProcessor,
    IdempotencyInterceptor,
    BullModule,
    DomainEventBus,
    DomainEventsProcessor,
    RedisThrottlerStorage,
    ThrottlerGuard,
    LoggingThrottlerGuard,
    IdentifierFailureThrottleInterceptor,
  ],
})
export class SharedModule {}
