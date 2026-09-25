import { Inject, Injectable } from "@nestjs/common";
import type { HealthIndicatorResult } from "@nestjs/terminus";
import { HealthCheckError, HealthIndicator } from "@nestjs/terminus";
import type { Pool } from "pg";

import { DATABASE_POOL } from "../database/database.module";

/**
 * `/health/ready` Postgres check (ULTRAPLAN 0.3, system-design.md §9). Borrows a
 * connection from the shared pool (`DatabaseModule`, ULTRAPLAN 0.4) for `SELECT 1` and
 * returns it right after — replaces the short-lived-connection-per-probe trade-off this
 * file used to document, now that a shared pool exists to reuse instead.
 */
@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.pool.query("SELECT 1");
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        "Postgres indisponível",
        this.getStatus(key, false, { message: messageOf(error) }),
      );
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}
