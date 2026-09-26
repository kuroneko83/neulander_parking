import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";

import { AppConfigModule } from "../../config/app-config.module";
import { AppConfigService } from "../../config/app-config.service";
import { DatabaseModule } from "../../database/database.module";
import { DomainEventBus } from "./infra/domain-events.bus";
import { DomainEventsProcessor } from "./infra/domain-events.processor";
import { IdempotencyInterceptor } from "./infra/idempotency.interceptor";
import { OutboxService } from "./infra/outbox.service";
import { DOMAIN_EVENTS_QUEUE, OutboxRelayProcessor } from "./infra/outbox-relay.processor";
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
  ],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    OutboxService,
    OutboxRelayProcessor,
    IdempotencyInterceptor,
    DomainEventBus,
    DomainEventsProcessor,
  ],
  exports: [
    CLOCK,
    OutboxService,
    OutboxRelayProcessor,
    IdempotencyInterceptor,
    BullModule,
    DomainEventBus,
    DomainEventsProcessor,
  ],
})
export class SharedModule {}
