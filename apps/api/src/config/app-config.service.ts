import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "./env.schema";

/**
 * Defensive normalization for PEM values (ULTRAPLAN 1.3): `dotenv` already expands a
 * literal `\n` inside a double-quoted `.env` value into a real newline (see
 * `.env.example`'s own "Use \n para quebras de linha" comment and the `dotenv` v18
 * source), so a `.env`-sourced key is normally already correct by the time it reaches
 * here. This stays as a safety net for the other places a PEM key can come from without
 * that same unescaping — a CI step exporting a single-line value via `$GITHUB_ENV`, or a
 * Secrets Manager string with a literal backslash-n — so the app doesn't silently fail to
 * parse a structurally-fine key just because of how it arrived. A no-op when the value
 * already has real newlines (no literal `\n` substring left to replace).
 */
function normalizePemNewlines(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

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

  get jwtAccessPrivateKey(): string {
    return normalizePemNewlines(this.configService.get("JWT_ACCESS_PRIVATE_KEY", { infer: true }));
  }

  get jwtAccessPublicKey(): string {
    return normalizePemNewlines(this.configService.get("JWT_ACCESS_PUBLIC_KEY", { infer: true }));
  }

  /** `ms`-style duration string (e.g. `"15m"`) — passed straight to `jsonwebtoken`'s
   * `expiresIn` option, which parses this same format itself. */
  get jwtAccessTtl(): string {
    return this.configService.get("JWT_ACCESS_TTL", { infer: true });
  }

  get jwtRefreshTtlDays(): number {
    return this.configService.get("JWT_REFRESH_TTL_DAYS", { infer: true });
  }

  get passwordPepper(): string {
    return this.configService.get("PASSWORD_PEPPER", { infer: true });
  }

  get webAppUrl(): string {
    return this.configService.get("WEB_APP_URL", { infer: true });
  }

  /** `SMTP_URL` if set, else `SMTP_DEV_URL` (env.schema.ts's fallback — see that file's
   * comment; `SMTP_DEV_URL` always has a default, so this never returns an empty string). */
  get smtpUrl(): string {
    const primary = this.configService.get("SMTP_URL", { infer: true });
    return primary && primary.length > 0
      ? primary
      : this.configService.get("SMTP_DEV_URL", { infer: true });
  }

  get emailFrom(): string {
    return this.configService.get("EMAIL_FROM", { infer: true });
  }
}
