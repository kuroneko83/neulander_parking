import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { AppConfigModule } from "../config/app-config.module";
import { DatabaseModule } from "../database/database.module";
import { DatabaseHealthIndicator } from "./database.health-indicator";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health-indicator";

// DatabaseModule/AppConfigModule are already `@Global()` (their exports would be
// injectable here regardless) — imported explicitly anyway so this module's
// dependencies are visible just by reading its `imports`, matching the existing
// AppConfigModule convention.
@Module({
  imports: [TerminusModule, AppConfigModule, DatabaseModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
