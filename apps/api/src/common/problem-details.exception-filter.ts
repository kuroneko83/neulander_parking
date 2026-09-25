import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { PinoLogger } from "nestjs-pino";

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
      this.logger.error({ err: exception }, "Exceção não tratada");
    }

    response
      .status(problem.status)
      .setHeader("Content-Type", "application/problem+json")
      .send(problem);
  }

  private toProblemDetails(exception: unknown): ProblemDetails {
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
