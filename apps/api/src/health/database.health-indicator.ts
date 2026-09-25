import { Injectable } from "@nestjs/common";
import type { HealthIndicatorResult } from "@nestjs/terminus";
import { HealthCheckError, HealthIndicator } from "@nestjs/terminus";
import { Client } from "pg";

import { AppConfigService } from "../config/app-config.service";

const CONNECT_TIMEOUT_MS = 2000;

/**
 * `/health/ready` Postgres check (ULTRAPLAN 0.3, system-design.md §9). Opens a
 * short-lived connection per probe and closes it right after — there's no shared
 * pool yet (Drizzle wiring is ULTRAPLAN 0.4); this only proves connectivity.
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly appConfig: AppConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const client = new Client({
      connectionString: this.appConfig.databaseUrl,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    // Without this, a failed/aborted connection emits an unhandled 'error' event that
    // would crash the process (Client extends EventEmitter) — we already handle the
    // failure via the rejected promise below.
    client.on("error", () => undefined);

    try {
      await client.connect();
      await client.query("SELECT 1");
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        "Postgres indisponível",
        this.getStatus(key, false, { message: messageOf(error) }),
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}
