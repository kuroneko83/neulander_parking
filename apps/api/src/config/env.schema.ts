import { z } from "zod";

/**
 * Environment schema (ULTRAPLAN 0.3) — validated once at bootstrap via
 * `@nestjs/config`'s `validate` option (see app-config.module.ts). Fails fast with a
 * readable error instead of letting the app start with `undefined` config.
 *
 * Scope: only the variables this layer (HTTP/worker bootstrap, logging, health checks)
 * actually needs today — NODE_ENV, API_PORT, API_HOST, CORS_ORIGIN, LOG_LEVEL,
 * DATABASE_URL, REDIS_URL (see .env.example and system-design.md §9).
 *
 * Deliberately NOT included yet: JWT/S3/SES/WhatsApp/Mercado Pago/Stripe variables.
 * They exist in .env.example but nothing in the codebase consumes them yet, and several
 * ship as literal "CHANGE_ME"/placeholder PEM blocks there — validating them now would
 * make a freshly cloned repo fail to boot the API for a task that doesn't need them.
 * Add each one to this schema (and to AppConfigService) in the task that first reads it.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  API_HOST: z.string().min(1).default("0.0.0.0"),

  // Comma-separated list of allowed CORS origins -> string[] (see .env.example comment).
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN não pode ser vazio")
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.string().min(1)).min(1, "CORS_ORIGIN precisa ter ao menos uma origem")),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL é obrigatório")
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL precisa começar com postgres:// ou postgresql://"),

  REDIS_URL: z
    .string()
    .min(1, "REDIS_URL é obrigatório")
    .regex(/^rediss?:\/\//, "REDIS_URL precisa começar com redis:// ou rediss://"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` (or an equivalent record). Used as `@nestjs/config`'s
 * `validate` function, so it must throw — not return an error object — to make Nest abort
 * bootstrap on invalid config.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Configuração de ambiente inválida. Verifique o \`.env\` (veja .env.example):\n${issues}`,
    );
  }

  return result.data;
}
