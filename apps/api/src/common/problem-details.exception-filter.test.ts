import type { ArgumentsHost } from "@nestjs/common";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PinoLogger } from "nestjs-pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Minimal stand-in for nestjs-pino's PinoLogger — only the members the filter calls.
// Cast through `unknown` (documented pattern already used in packages/config's tests)
// because PinoLogger has private fields, so a plain object isn't structurally assignable.
function createLoggerStub(): PinoLogger {
  return {
    setContext: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
}

function sentBody(res: MockResponse): Record<string, unknown> {
  return res.send.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ProblemDetailsExceptionFilter", () => {
  let filter: ProblemDetailsExceptionFilter;

  beforeEach(() => {
    filter = new ProblemDetailsExceptionFilter(createLoggerStub());
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

  it("sets the Content-Type header to application/problem+json", () => {
    const { host, res } = createHost();

    filter.catch(new NotFoundException(), host);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/problem+json");
  });
});
