import type { ArgumentsHost } from "@nestjs/common";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { PinoLogger } from "nestjs-pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same reasoning as the filter itself: import the pure domain file directly, not the
// `modules/shared` barrel (which would drag in AppConfigModule/DatabaseModule and their
// `process.env` validation into this dependency-free unit test).
import { DomainError } from "../modules/shared/domain/domain-error";
import { ProblemDetailsExceptionFilter } from "./problem-details.exception-filter";

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function createHost(): { host: ArgumentsHost; res: MockResponse } {
  const res: MockResponse = {
    status: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);

  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return { host, res };
}

interface LoggerStub {
  setContext: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

// Minimal stand-in for nestjs-pino's PinoLogger — only the members the filter calls.
// Cast through `unknown` (documented pattern already used in packages/config's tests)
// because PinoLogger has private fields, so a plain object isn't structurally assignable.
function createLoggerStub(): LoggerStub {
  return {
    setContext: vi.fn(),
    error: vi.fn(),
  };
}

/** The `err` field of whatever `logger.error({ err, ... }, message)` was last called with —
 * lets a test assert on what actually reaches the log sink, not just the HTTP response. */
function loggedErr(logger: LoggerStub): unknown {
  const lastCall = logger.error.mock.calls.at(-1) as [{ err?: unknown }] | undefined;
  return lastCall?.[0]?.err;
}

function sentBody(res: MockResponse): Record<string, unknown> {
  return res.send.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ProblemDetailsExceptionFilter", () => {
  let filter: ProblemDetailsExceptionFilter;
  let logger: LoggerStub;

  beforeEach(() => {
    logger = createLoggerStub();
    filter = new ProblemDetailsExceptionFilter(logger as unknown as PinoLogger);
  });

  it("maps NotFoundException to a 404 problem+json body with code NOT_FOUND", () => {
    const { host, res } = createHost();

    filter.catch(new NotFoundException("Estacionamento não encontrado"), host);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = sentBody(res);

    expect(body).toMatchObject({
      type: "about:blank",
      status: 404,
      code: "NOT_FOUND",
      detail: "Estacionamento não encontrado",
    });
    expect(body["errors"]).toBeUndefined();
  });

  it("maps a BadRequestException with validation-style messages to 400 / VALIDATION_ERROR with errors", () => {
    const { host, res } = createHost();

    filter.catch(
      new BadRequestException(["plate must be a valid plate", "entryAt must be a date"]),
      host,
    );

    const body = sentBody(res);

    expect(body).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(body["errors"]).toEqual({
      messages: ["plate must be a valid plate", "entryAt must be a date"],
    });
  });

  it("maps a generic unhandled Error to a 500 problem+json body with code INTERNAL_ERROR", () => {
    const { host, res } = createHost();

    filter.catch(new Error("boom"), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = sentBody(res);

    expect(body).toMatchObject({
      type: "about:blank",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    // Never leak the raw error message (could contain internals) in the generic case.
    expect(body["detail"]).toBe("Ocorreu um erro inesperado.");
  });

  it("maps a Terminus-style ServiceUnavailableException (health check failure) to 503 / SERVICE_UNAVAILABLE, preserving per-dependency detail", () => {
    const { host, res } = createHost();

    filter.catch(
      new ServiceUnavailableException({
        status: "error",
        info: {},
        error: { redis: { status: "down", message: "connect ECONNREFUSED" } },
        details: {
          database: { status: "up" },
          redis: { status: "down", message: "connect ECONNREFUSED" },
        },
      }),
      host,
    );

    const body = sentBody(res);

    expect(body).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      errors: {
        database: { status: "up" },
        redis: { status: "down", message: "connect ECONNREFUSED" },
      },
    });
  });

  it("maps a DomainError to its own code/httpStatus, bypassing the generic status table", () => {
    const { host, res } = createHost();

    filter.catch(new DomainError("SESSION_ALREADY_OPEN", "Sessão já está aberta.", 409), host);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = sentBody(res);

    expect(body).toMatchObject({
      type: "about:blank",
      status: 409,
      code: "SESSION_ALREADY_OPEN",
      detail: "Sessão já está aberta.",
    });
  });

  it("defaults a DomainError's httpStatus to 422 when none is given", () => {
    const { host, res } = createHost();

    filter.catch(new DomainError("INVALID_PLATE", "Placa inválida."), host);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(sentBody(res)).toMatchObject({ status: 422, code: "INVALID_PLATE" });
  });

  it("sets the Content-Type header to application/problem+json", () => {
    const { host, res } = createHost();

    filter.catch(new NotFoundException(), host);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
  });

  it("logs a generic Error unchanged — sanitization only ever applies to DrizzleQueryError", () => {
    const { host } = createHost();
    const error = new Error("boom");

    filter.catch(error, host);

    expect(loggedErr(logger)).toBe(error);
  });

  describe("DrizzleQueryError sanitization (security-review fix — LGPD, CLAUDE.md regra 10)", () => {
    /** A believable stand-in for pg's own `DatabaseError` — the object `DrizzleQueryError`
     * wraps as `.cause` for an actual driver-level failure. Real `DatabaseError`s have many
     * more fields (`detail`, `severity`, `table`, ...); only `code`/`constraint` matter here
     * (what `sanitizeDrizzleQueryErrorForLogging` is documented to keep). */
    function buildDrizzleQueryError(): {
      error: DrizzleQueryError;
      email: string;
      passwordHash: string;
    } {
      const email = "convidado.sensivel@example.test";
      const passwordHash = "$argon2id$v=19$m=65536,t=3,p=4$totallysecrethash";
      const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
        constraint: "invitations_org_email_pending_unique",
      });
      const error = new DrizzleQueryError(
        'insert into "invitations" ("email", "password_hash") values ($1, $2)',
        [email, passwordHash],
        cause,
      );
      return { error, email, passwordHash };
    }

    it("never logs the raw email/password hash bound as query params — checked across message, stack AND the whole logged payload", () => {
      const { host } = createHost();
      const { error, email, passwordHash } = buildDrizzleQueryError();

      filter.catch(error, host);

      const logged = loggedErr(logger);
      const serialized = JSON.stringify(logged) + String((logged as { stack?: string }).stack);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain(passwordHash);
    });

    it("strips query/params entirely, keeping only name/message/code/constraint", () => {
      const { host } = createHost();
      const { error } = buildDrizzleQueryError();

      filter.catch(error, host);

      const logged = loggedErr(logger) as Record<string, unknown>;
      expect(logged["query"]).toBeUndefined();
      expect(logged["params"]).toBeUndefined();
      expect(logged["cause"]).toBeUndefined();
      expect(logged).toMatchObject({
        name: "DrizzleQueryError",
        code: "23505",
        constraint: "invitations_org_email_pending_unique",
      });
    });

    it("omits code/constraint (rather than throwing) when .cause isn't a recognizable driver error", () => {
      const { host } = createHost();
      const error = new DrizzleQueryError("select 1", [], undefined);

      filter.catch(error, host);

      const logged = loggedErr(logger) as Record<string, unknown>;
      expect(logged["name"]).toBe("DrizzleQueryError");
      expect("code" in logged).toBe(false);
      expect("constraint" in logged).toBe(false);
    });

    it("still returns the generic, client-safe 500 body — sanitization only changes what's logged, not the HTTP response", () => {
      const { host, res } = createHost();
      const { error } = buildDrizzleQueryError();

      filter.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(sentBody(res)).toMatchObject({
        status: 500,
        code: "INTERNAL_ERROR",
        detail: "Ocorreu um erro inesperado.",
      });
    });

    it("applies the same sanitization for a query failure that ISN'T a unique violation (e.g. a check/FK violation or timeout)", () => {
      const { host } = createHost();
      const email = "outro.convidado@example.test";
      const cause = Object.assign(new Error("check constraint violated"), { code: "23514" });
      const error = new DrizzleQueryError('insert into "users" ("email") values ($1)', [email], cause);

      filter.catch(error, host);

      const logged = loggedErr(logger) as Record<string, unknown>;
      expect(JSON.stringify(logged)).not.toContain(email);
      expect(logged["code"]).toBe("23514");
    });
  });
});
