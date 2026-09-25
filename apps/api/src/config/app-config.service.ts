import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "./env.schema";

/**
 * Typed façade over `@nestjs/config`'s `ConfigService`, so the rest of the app never
 * touches raw string keys/generics. The underlying `ConfigService` is fed the object
 * returned by `validateEnv` (Zod) — see AppConfigModule — so every value read here is
 * already parsed/coerced/defaulted.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  get nodeEnv(): Env["NODE_ENV"] {
    return this.configService.get("NODE_ENV", { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get http(): { port: number; host: string } {
    return {
      port: this.configService.get("API_PORT", { infer: true }),
      host: this.configService.get("API_HOST", { infer: true }),
    };
  }

  get corsOrigins(): string[] {
    return this.configService.get("CORS_ORIGIN", { infer: true });
  }

  get logLevel(): Env["LOG_LEVEL"] {
    return this.configService.get("LOG_LEVEL", { infer: true });
  }

  get databaseUrl(): string {
    return this.configService.get("DATABASE_URL", { infer: true });
  }

  get databasePool(): { min: number; max: number } {
    return {
      min: this.configService.get("DATABASE_POOL_MIN", { infer: true }),
      max: this.configService.get("DATABASE_POOL_MAX", { infer: true }),
    };
  }

  get redisUrl(): string {
    return this.configService.get("REDIS_URL", { infer: true });
  }
}
