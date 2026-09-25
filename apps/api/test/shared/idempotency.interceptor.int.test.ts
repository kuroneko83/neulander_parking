/**
 * Integration test for `IdempotencyInterceptor` (ULTRAPLAN 0.5) — "pode mockar a camada
 * HTTP do Nest, mas não mockar o banco". `ExecutionContext`/`CallHandler` below are
 * hand-built stand-ins for the HTTP layer (no real Express request/response, no full
 * Nest app with controllers); the interceptor itself is pulled out of a real `AppModule`
 * DI graph so it talks to the real Postgres from `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 */
import "reflect-metadata";

import type { CallHandler, ExecutionContext, INestApplication } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { firstValueFrom, of } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../../src/app.module";
import type { Database } from "../../src/database/database.module";
import { DATABASE_CONNECTION } from "../../src/database/database.module";
import { IdempotencyInterceptor } from "../../src/modules/shared";
import { idempotencyKeys } from "../../src/modules/shared/infra/schema";

interface FakeRequestOptions {
  key?: string;
  body?: unknown;
  method?: string;
  ip?: string;
}

function createContext(
  options: FakeRequestOptions,
  handlerHttpCode?: number,
): { context: ExecutionContext; request: { header: ReturnType<typeof vi.fn> } } {
  const headers: Record<string, string> = {};
  if (options.key !== undefined) {
    headers["Idempotency-Key"] = options.key;
  }
  const header = vi.fn((name: string) => headers[name]);
  const request = {
    header,
    body: options.body,
    method: options.method ?? "POST",
    ip: options.ip ?? "127.0.0.1",
  };
  const handler = (): void => undefined;
  if (handlerHttpCode !== undefined) {
    Reflect.defineMetadata(HTTP_CODE_METADATA, handlerHttpCode, handler);
  }

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => class FakeController {},
  } as unknown as ExecutionContext;

  return { context, request: { header } };
}

function createCallHandler(returnValue: unknown): { handler: CallHandler; handle: ReturnType<typeof vi.fn> } {
  const handle = vi.fn(() => of(returnValue));
  return { handler: { handle }, handle };
}

/** `store()` runs fire-and-forget from the interceptor's point of view (see its own doc
 * comment) — polls the real table briefly instead of a fixed sleep, since how long the
 * write takes depends on the real Postgres connection. */
async function waitForStoredRow(
  db: Database,
  scope: string,
  key: string,
): Promise<typeof idempotencyKeys.$inferSelect | undefined> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key));
    if (row && row.scope === scope) {
      return row;
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("IdempotencyInterceptor (real Postgres from compose, fake HTTP layer)", () => {
  let app: INestApplication;
  let db: Database;
  let interceptor: IdempotencyInterceptor;
  const keysToCleanUp: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(DATABASE_CONNECTION);
    interceptor = app.get(IdempotencyInterceptor);
  });

  afterAll(async () => {
    for (const key of keysToCleanUp) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
    }
    await app.close();
  });

  it("rejects a request with no Idempotency-Key header with 400", () => {
    const { context } = createContext({ body: { plate: "ABC1D23" } });
    const { handler, handle } = createCallHandler({ ok: true });

    expect(() => interceptor.intercept(context, handler)).toThrow(
      /Idempotency-Key é obrigatório/,
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) Idempotency-Key with 400", () => {
    const { context } = createContext({ key: "not-a-uuid", body: {} });
    const { handler } = createCallHandler({ ok: true });

    expect(() => interceptor.intercept(context, handler)).toThrow(/precisa ser um UUID/);
  });

  it("runs the handler on first use, then replays the stored response for a repeat with the same body", async () => {
    const key = "11111111-1111-1111-1111-111111111111";
    const ip = "203.0.113.10";
    keysToCleanUp.push(key);
    const body = { plate: "ABC1D23", spotId: null };

    const first = createContext({ key, body, ip }, 201);
    const firstHandler = createCallHandler({ sessionId: "s-1", status: "open" });

    const firstResult = await firstValueFrom(interceptor.intercept(first.context, firstHandler.handler));
    expect(firstResult).toEqual({ sessionId: "s-1", status: "open" });
    expect(firstHandler.handle).toHaveBeenCalledTimes(1);

    const stored = await waitForStoredRow(db, `ip:${ip}`, key);
    expect(stored).toBeDefined();
    expect(stored?.responseStatus).toBe(201);
    expect(stored?.responseBody).toEqual({ sessionId: "s-1", status: "open" });

    // Second call: identical key + identical body -> replays without invoking the handler.
    const second = createContext({ key, body, ip }, 201);
    const secondHandler = createCallHandler({ sessionId: "SHOULD_NOT_BE_RETURNED" });

    const secondResult = await firstValueFrom(
      interceptor.intercept(second.context, secondHandler.handler),
    );
    expect(secondResult).toEqual({ sessionId: "s-1", status: "open" });
    expect(secondHandler.handle).not.toHaveBeenCalled();
  });

  it("returns 409 when the same key is reused with a different body", async () => {
    const key = "22222222-2222-2222-2222-222222222222";
    const ip = "203.0.113.20";
    keysToCleanUp.push(key);

    const first = createContext({ key, body: { plate: "ABC1D23" }, ip }, 201);
    const firstHandler = createCallHandler({ sessionId: "s-2" });
    await firstValueFrom(interceptor.intercept(first.context, firstHandler.handler));
    await waitForStoredRow(db, `ip:${ip}`, key);

    const second = createContext({ key, body: { plate: "XYZ9Z99" }, ip }, 201);
    const secondHandler = createCallHandler({ sessionId: "SHOULD_NOT_RUN" });

    await expect(
      firstValueFrom(interceptor.intercept(second.context, secondHandler.handler)),
    ).rejects.toThrow(/corpo de requisição diferente/);
    expect(secondHandler.handle).not.toHaveBeenCalled();
  });

  it("scopes by caller IP (the pre-auth placeholder): the same key from a different IP is treated as a different request", async () => {
    const key = "33333333-3333-3333-3333-333333333333";
    const ipA = "203.0.113.30";
    const ipB = "203.0.113.31";
    keysToCleanUp.push(key);

    const first = createContext({ key, body: { plate: "ABC1D23" }, ip: ipA }, 201);
    const firstHandler = createCallHandler({ sessionId: "s-from-ip-a" });
    await firstValueFrom(interceptor.intercept(first.context, firstHandler.handler));
    await waitForStoredRow(db, `ip:${ipA}`, key);

    const second = createContext({ key, body: { plate: "ABC1D23" }, ip: ipB }, 201);
    const secondHandler = createCallHandler({ sessionId: "s-from-ip-b" });
    const secondResult = await firstValueFrom(
      interceptor.intercept(second.context, secondHandler.handler),
    );

    expect(secondResult).toEqual({ sessionId: "s-from-ip-b" });
    expect(secondHandler.handle).toHaveBeenCalledTimes(1);
  });
});
