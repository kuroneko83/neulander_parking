import type { OnModuleDestroy } from "@nestjs/common";
import { Global, Inject, Logger, Module } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { AppConfigModule } from "../config/app-config.module";
import { AppConfigService } from "../config/app-config.service";
import { CONNECTION_TIMEOUT_MS } from "./connection-config";
import * as schema from "./schema";

/** DI token for the shared `pg.Pool`. Prefer injecting `DATABASE_CONNECTION` (the
 * Drizzle-wrapped client) in domain repositories — this one exists mainly for
 * infrastructure that needs the raw pool itself (e.g. a health check). */
export const DATABASE_POOL = Symbol("DATABASE_POOL");

/** DI token for the shared Drizzle client. `modules/<ctx>/infra/*.repository.ts`
 * (Phase 1+) injects this instead of opening its own `pg` connection. */
export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");

export type Database = NodePgDatabase<typeof schema>;

/**
 * Shared Postgres/Drizzle client (ULTRAPLAN 0.4, ADR-0003). One `pg.Pool` for the whole
 * process — sized by `DATABASE_POOL_MIN`/`DATABASE_POOL_MAX` — wrapped once by
 * `drizzle()`. Domain modules never construct their own `Pool`/`Client`; their
 * repositories (`modules/<ctx>/infra/*.repository.ts`, starting Phase 1) inject
 * `DATABASE_CONNECTION`.
 *
 * `@Global()` (same pattern as `AppConfigModule`): every future domain module's infra
 * layer needs this, and re-importing `DatabaseModule` in each of them would just be
 * boilerplate — it's imported once from `AppModule`.
 *
 * Lifecycle: the module class itself (not a listed provider) implements
 * `OnModuleDestroy` and closes the pool on shutdown — Nest instantiates every module
 * class and lets it inject its own providers, wiring this into `app.enableShutdownHooks()`
 * (already called in main.ts/main.worker.ts) for free.
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService): Pool => {
        const { min, max } = appConfig.databasePool;
        const pool = new Pool({
          connectionString: appConfig.databaseUrl,
          min,
          max,
          // Fail fast instead of hanging forever when Postgres is unreachable/the pool
          // is exhausted — matters for /health/ready (DatabaseHealthIndicator borrows a
          // connection from this same pool) and for normal request handling alike.
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        });
        // Without this, an error on an idle client (e.g. the network dropping a
        // connection Postgres already closed) emits an unhandled 'error' event that
        // would crash the process (Pool is an EventEmitter) — see the `pg` docs and
        // the same trade-off documented in DatabaseHealthIndicator.
        pool.on("error", (error: Error) => {
          new Logger(DatabaseModule.name).error(
            `Erro em conexão ociosa do pool Postgres: ${error.message}`,
          );
        });
        return pool;
      },
    },
    {
      provide: DATABASE_CONNECTION,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DATABASE_POOL, DATABASE_CONNECTION],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
