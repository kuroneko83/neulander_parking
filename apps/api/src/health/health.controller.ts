import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthCheckResult, HealthIndicatorResult } from "@nestjs/terminus";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";

import { DatabaseHealthIndicator } from "./database.health-indicator";
import { RedisHealthIndicator } from "./redis.health-indicator";

/**
 * Health checks (ULTRAPLAN 0.3, system-design.md §9): `/health/live` (process is up,
 * no external dependency checked) and `/health/ready` (Postgres + Redis reachable).
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get("live")
  @HealthCheck()
  @ApiOperation({
    summary: "Liveness — o processo está de pé, sem checar dependências externas",
  })
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get("ready")
  @HealthCheck()
  @ApiOperation({
    summary: "Readiness — checa conectividade real com Postgres e Redis",
  })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      (): Promise<HealthIndicatorResult> => this.database.isHealthy("database"),
      (): Promise<HealthIndicatorResult> => this.redis.isHealthy("redis"),
    ]);
  }
}
