import { Injectable } from "@nestjs/common";
import type { HealthIndicatorResult } from "@nestjs/terminus";
import { HealthCheckError, HealthIndicator } from "@nestjs/terminus";
import { Redis } from "ioredis";

import { AppConfigService } from "../config/app-config.service";

const CONNECT_TIMEOUT_MS = 2000;

/**
 * `/health/ready` Redis check (ULTRAPLAN 0.3, system-design.md §9). Opens a short-lived
 * connection per probe — there's no shared client yet (that comes with BullMQ/cache
 * wiring in later tasks); this only proves connectivity.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly appConfig: AppConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const client = new Redis(this.appConfig.redisUrl, {
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // fail fast — a health probe must not hang retrying.
    });
    // Without this, ioredis (an EventEmitter) crashes the process on a connection
    // error with no listener — we already handle the failure via the rejected promise.
    client.on("error", () => undefined);

    try {
      await client.connect();
      await client.ping();
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        "Redis indisponível",
        this.getStatus(key, false, { message: messageOf(error) }),
      );
    } finally {
      client.disconnect();
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}
