import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { AppConfigModule } from "../config/app-config.module";
import { DatabaseHealthIndicator } from "./database.health-indicator";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health-indicator";

@Module({
  imports: [TerminusModule, AppConfigModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
