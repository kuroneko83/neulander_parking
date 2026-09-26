import { z } from "zod";

/**
 * Environment schema (ULTRAPLAN 0.3) — validated once at bootstrap via
 * `@nestjs/config`'s `validate` option (see app-config.module.ts). Fails fast with a
 * readable error instead of letting the app start with `undefined` config.
 *
 * Scope: only the variables this layer (HTTP/worker bootstrap, logging, health checks,
 * shared Drizzle pool) actually needs today — NODE_ENV, API_PORT, API_HOST, CORS_ORIGIN,
 * LOG_LEVEL, DATABASE_URL, DATABASE_POOL_MIN/MAX, REDIS_URL (see .env.example and
 * system-design.md §9).
 *
 * Deliberately NOT included yet: S3/SES/WhatsApp/Mercado Pago/Stripe variables. They exist
 * in .env.example but nothing in the codebase consumes them yet, and several ship as
 * literal "CHANGE_ME"/placeholder blocks there — validating them now would make a freshly
 * cloned repo fail to boot the API for a task that doesn't need them. Add each one to this
 * schema (and to AppConfigService) in the task that first reads it.
 *
 * JWT/pepper variables (ULTRAPLAN 1.3, ADR-0004) ARE included below — this is that task.
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
  // Tamanho do pool `pg` compartilhado (ULTRAPLAN 0.4, DatabaseModule) — já previstos em
  // .env.example desde a tarefa 0.1, sem consumidor até agora.
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  REDIS_URL: z
    .string()
    .min(1, "REDIS_URL é obrigatório")
    .regex(/^rediss?:\/\//, "REDIS_URL precisa começar com redis:// ou rediss://"),

  // --- Auth — JWT RS256 + refresh rotativo (ADR-0004, ULTRAPLAN 1.3) ---
  // PEM blocks, not parsed/validated as real RSA keys here (that's `jsonwebtoken`'s job at
  // sign/verify time, inside AuthJwtService) — only checked for the markers that mean
  // "looks like the right kind of PEM", so an empty/wrong-shaped value fails fast at
  // bootstrap instead of surfacing as a confusing signing error on the first request.
  JWT_ACCESS_PRIVATE_KEY: z
    .string()
    .min(1, "JWT_ACCESS_PRIVATE_KEY é obrigatório")
    .refine(
      (value) => value.includes("PRIVATE KEY"),
      "JWT_ACCESS_PRIVATE_KEY precisa ser uma chave privada PEM",
    ),
  JWT_ACCESS_PUBLIC_KEY: z
    .string()
    .min(1, "JWT_ACCESS_PUBLIC_KEY é obrigatório")
    .refine(
      (value) => value.includes("PUBLIC KEY"),
      "JWT_ACCESS_PUBLIC_KEY precisa ser uma chave pública PEM",
    ),
  // `jsonwebtoken`/`ms` duration string (ADR-0004: access token de 15 min).
  JWT_ACCESS_TTL: z
    .string()
    .regex(
      /^\d+(ms|s|m|h|d|w|y)$/,
      "JWT_ACCESS_TTL precisa seguir o formato do pacote `ms` (ex.: 15m, 1h)",
    )
    .default("15m"),
  // ADR-0004: refresh token opaco de 30 dias.
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  // Aplicado como `secret` do argon2id (ver PasswordHasher) — nunca logado. Mínimo de 32
  // caracteres para que realmente contribua entropia ao input do Argon2 (`min(1)` deixaria
  // passar algo como "x", que não pepper nada de verdade).
  PASSWORD_PEPPER: z.string().min(32, "PASSWORD_PEPPER precisa ter ao menos 32 caracteres"),

  // --- Convite de membros / e-mail (ADR-0013, ULTRAPLAN 1.5) ---
  // Base do painel web usada para montar o link de aceite de convite
  // (`${WEB_APP_URL}/accept-invite/:token}`) — nunca hardcoded no template
  // (modules/notifications/domain/templates/member-invite.ts).
  WEB_APP_URL: z
    .string()
    .regex(/^https?:\/\//, "WEB_APP_URL precisa começar com http:// ou https://")
    .default("http://localhost:5173"),
  // `SmtpEmailChannel` (nodemailer) lê `SMTP_URL`; se ausente, cai para `SMTP_DEV_URL`
  // (Mailpit local, .env.example) — ver AppConfigService.smtpUrl. Nenhum dos dois é
  // obrigatório: um `.env` recém-clonado (Fase 0/1) já sobe com o Mailpit do
  // infra/docker/compose.yml e o default de SMTP_DEV_URL aponta pra ele.
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, "SMTP_URL precisa começar com smtp:// ou smtps://")
    .optional(),
  SMTP_DEV_URL: z
    .string()
    .regex(/^smtps?:\/\//, "SMTP_DEV_URL precisa começar com smtp:// ou smtps://")
    .default("smtp://localhost:1025"),
  EMAIL_FROM: z.email().default("relatorios@neulander-parking.example.com"),
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
