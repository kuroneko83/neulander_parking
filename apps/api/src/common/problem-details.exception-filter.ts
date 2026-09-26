import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
// `drizzle-orm/errors` — a small, side-effect-free subpath (just the error class
// declarations, no DB/env touching) — same reasoning as `DomainError`'s own import below for
// why this is safe to pull straight in rather than through a barrel: nothing here eagerly
// validates `process.env`/opens a connection.
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { Response } from "express";
import { PinoLogger } from "nestjs-pino";

// Deliberately imported from the pure domain file, not `modules/shared`'s public
// `index.ts` barrel: that barrel also re-exports `SharedModule` (Nest/Drizzle/BullMQ
// wiring), so importing anything from it — even just this plain `Error` subclass — would
// eagerly evaluate `AppConfigModule`/`DatabaseModule` too (they validate `process.env`/
// build a pool at import time, see main.ts's comment on `ConfigModule.forRoot()`). This
// filter is instantiated by `AppModule` itself and exercised by pure unit tests
// (`problem-details.exception-filter.test.ts`, no `.env` loaded) — pulling in that whole
// graph here broke exactly those tests. `domain/domain-error.ts` is pure TS by design
// (no Nest/Drizzle import) specifically so cross-cutting code like this can depend on it
// without depending on the rest of the module.
import { DomainError } from "../modules/shared/domain/domain-error";
import type { ProblemDetails } from "./problem-details";

/** RFC 9457 §4.2: "about:blank" means "no further information beyond the HTTP status". */
const PROBLEM_TYPE = "about:blank";

/**
 * Stable `code` per HTTP status for exceptions that don't carry their own domain code
 * (domain errors from future modules will set their own, e.g. `SESSION_ALREADY_OPEN`).
 */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "VALIDATION_ERROR",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "VALIDATION_ERROR",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface DescribedError {
  title: string;
  detail: string;
  errors?: Record<string, unknown>;
}

/**
 * Security-review fix (ULTRAPLAN 1.5, same LGPD/log-hygiene concern as the unique-violation
 * translation in `invitations.repository.ts`/`memberships.repository.ts`, just a different
 * trigger): `DrizzleQueryError` (`drizzle-orm/errors`) builds its OWN `.message` as
 * `` `Failed query: ${query}\nparams: ${params}` `` and exposes `query`/`params` as regular
 * own (enumerable) instance properties — pino's default `err` serializer copies all of that
 * verbatim, and `.stack` ALSO embeds `.message` (V8 prepends `name: message` to a captured
 * stack trace) — so simply omitting `query`/`params` from a shallow copy isn't enough, three
 * different properties on the same object all carry the bound SQL parameters (an invitee's
 * e-mail, an argon2 password hash, a token hash, ...).
 *
 * This isn't only about the two unique-violation cases those two repositories already
 * translate to a `DomainError` before this filter ever sees them — the SAME
 * `DrizzleQueryError` shape (and therefore the same leak) happens for ANY other query
 * failure this codebase doesn't specifically translate: a check/FK violation, a statement
 * timeout, connection churn, etc. This filter is shared by every module (`APP_FILTER`), so
 * fixing it here — rather than in each repository — closes the gap for all of them, present
 * and future, in one place.
 *
 * Builds a BRAND NEW, minimal plain object with only an allowlist of safe fields
 * (`name`, a fixed generic `message`, and `code`/`constraint` off the real driver error at
 * `.cause` — e.g. Postgres' own `DatabaseError`, never the query/params) — never a shallow
 * copy/mutation of the original error, so nothing on it (including `.stack`) can leak
 * through by accident.
 */
function sanitizeDrizzleQueryErrorForLogging(error: DrizzleQueryError): Record<string, unknown> {
  const cause = error.cause as { code?: unknown; constraint?: unknown } | undefined;

  return {
    name: "DrizzleQueryError",
    message:
      "Falha de consulta ao banco de dados — query/params omitidos do log (LGPD, CLAUDE.md regra 10).",
    ...(typeof cause?.code === "string" ? { code: cause.code } : {}),
    ...(typeof cause?.constraint === "string" ? { constraint: cause.constraint } : {}),
  };
}

/** Only ever transforms the LOGGED representation of an exception — never the value used to
 * build the HTTP response (`toProblemDetails`), which already falls back to the generic,
 * client-safe "Internal Server Error" body for anything that isn't a `DomainError`/
 * `HttpException` (i.e. exactly the `DrizzleQueryError` case this function handles). */
function sanitizeForLogging(exception: unknown): unknown {
  if (exception instanceof DrizzleQueryError) {
    return sanitizeDrizzleQueryErrorForLogging(exception);
  }
  return exception;
}

/**
 * Global error filter (ULTRAPLAN 0.3): every unhandled exception becomes
 * `application/problem+json` in the shape `{ type, title, status, detail, code, errors? }`
 * (docs/architecture/api-and-events.md line 12). Registered as `APP_FILTER` in
 * AppModule so Nest DI can inject `PinoLogger` (LGPD: never log raw request bodies here —
 * only the exception itself; today no personal data flows through this layer).
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblemDetails(exception);

    if (problem.status >= 500) {
      this.logger.error({ err: sanitizeForLogging(exception) }, "Exceção não tratada");
    }

    response
      .status(problem.status)
      .setHeader("Content-Type", "application/problem+json")
      .send(problem);
  }

  private toProblemDetails(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      return this.fromDomainError(exception);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return {
      type: PROBLEM_TYPE,
      title: "Internal Server Error",
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: "Ocorreu um erro inesperado.",
      code: "INTERNAL_ERROR",
    };
  }

  /**
   * `DomainError` (ULTRAPLAN 0.5, `modules/shared`) carries its own stable `code` and
   * `httpStatus` — unlike generic Nest exceptions, there's no status-to-code table lookup
   * here, the error itself is the source of truth. `message` is used verbatim as `detail`:
   * every `DomainError` subclass is expected to build a message that's already safe to
   * show a client (CLAUDE.md rule 10 — e.g. `normalizePlate()` masks the plate in its own
   * error message before this filter ever sees it).
   */
  private fromDomainError(exception: DomainError): ProblemDetails {
    return {
      type: PROBLEM_TYPE,
      title: "Erro de negócio",
      status: exception.httpStatus,
      detail: exception.message,
      code: exception.code,
    };
  }

  private fromHttpException(exception: HttpException): ProblemDetails {
    const status = exception.getStatus();
    const described = this.describe(exception.getResponse(), exception.message, status);

    return {
      type: PROBLEM_TYPE,
      title: described.title,
      status,
      detail: described.detail,
      code: codeForStatus(status),
      ...(described.errors ? { errors: described.errors } : {}),
    };
  }

  private describe(body: string | object, fallbackTitle: string, status: number): DescribedError {
    if (typeof body === "string") {
      return { title: fallbackTitle, detail: body };
    }

    if (isRecord(body)) {
      const message = body["message"];

      // Nest's ValidationPipe (class-validator) / nestjs-zod shape `message` as a list.
      if (Array.isArray(message)) {
        return {
          title: codeForStatus(status) === "VALIDATION_ERROR" ? "Erro de validação" : fallbackTitle,
          detail: "Um ou mais campos são inválidos.",
          errors: { messages: message },
        };
      }

      if (typeof message === "string") {
        return { title: fallbackTitle, detail: message };
      }

      // `@nestjs/terminus` health-check failures throw a ServiceUnavailableException
      // whose body is `{ status, info, error, details }` (no `message`) — surface
      // `details` as `errors` instead of silently dropping which dependency failed.
      if (isRecord(body["details"])) {
        return {
          title: "Serviço indisponível",
          detail: "Uma ou mais dependências não estão saudáveis.",
          errors: body["details"],
        };
      }
    }

    return { title: fallbackTitle, detail: fallbackTitle };
  }
}
