import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { ThrottlerGetTrackerFunction } from "@nestjs/throttler";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { IdentifierFailureThrottleInterceptor } from "./identifier-failure-throttle.interceptor";
import type { RedisThrottlerStorage } from "./redis-throttler-storage";

/** Minimal stand-in for `Reflector` — the interceptor only ever calls `.get(...)`, and this
 * unit test only cares about the "route IS decorated" branch (the "not decorated" no-op
 * branch is a trivial early return, unaffected by this round's fix). Same "cast through
 * unknown" pattern the other rate-limit unit tests already use for a Nest collaborator. */
function fakeReflector(getIdentifier: ThrottlerGetTrackerFunction): Reflector {
  return { get: () => getIdentifier } as unknown as Reflector;
}

/** Minimal stand-in for `RedisThrottlerStorage` — only `increment`/`reset` are called by the
 * interceptor. `increment` always reports blocked here since this file only exercises the
 * round-4 sampled-block-warn fix, not the (already covered elsewhere, by
 * `test/identity/rate-limit.int.test.ts`) increment/reset semantics themselves. */
function fakeStorage(): RedisThrottlerStorage {
  return {
    increment: vi.fn().mockResolvedValue({
      totalHits: 999,
      timeToExpire: 900,
      isBlocked: true,
      timeToBlockExpire: 900,
    }),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisThrottlerStorage;
}

function fakeResponse(): { setHeader: ReturnType<typeof vi.fn> } {
  return { setHeader: vi.fn() };
}

function fakeContext(className: string, handlerName: string): ExecutionContext {
  const request = { body: { email: "victim@example.test" } };
  const response = fakeResponse();
  return {
    getClass: () => ({ name: className }) as never,
    getHandler: () => ({ name: handlerName }) as never,
    switchToHttp: () => ({
      getRequest: () => request as never,
      getResponse: () => response as unknown as Response,
    }),
  } as unknown as ExecutionContext;
}

function fakeCallHandler(): CallHandler {
  return { handle: () => of("never reached — every call in this file is blocked before the handler") };
}

/** Every request in this file uses this SAME tracker (a fixed identifier) — the point of
 * these tests is the SAMPLING of the block warn, not identifier derivation (already covered
 * elsewhere by `rate-limit.config.test.ts`'s `trackByBodyField`/`trackByParam` tests). */
const fixedTracker: ThrottlerGetTrackerFunction = () => "body.email:victim@example.test";

describe("IdentifierFailureThrottleInterceptor (round-4 security-review fix, MEDIUM — sampled block warn)", () => {
  it("samples the block warn per route — a burst of blocked requests against the SAME route logs only once per window, with a suppressed count noted", async () => {
    const interceptor = new IdentifierFailureThrottleInterceptor(fakeReflector(fixedTracker), fakeStorage());
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");

    const baseTime = 1_000_000;
    nowSpy.mockReturnValue(baseTime);
    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "login"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);

    nowSpy.mockReturnValue(baseTime + 100);
    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "login"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "login"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(baseTime + 5_001);
    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "login"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const secondMessage = warnSpy.mock.calls[1]?.[0] as string;
    expect(secondMessage).toContain("2");
    expect(secondMessage.toLowerCase()).toContain("suprimid");

    warnSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it("a DIFFERENT route's block still logs immediately, unaffected by another route's own sampling window", async () => {
    const interceptor = new IdentifierFailureThrottleInterceptor(fakeReflector(fixedTracker), fakeStorage());
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "login"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      lastValueFrom(await interceptor.intercept(fakeContext("AuthController", "register"), fakeCallHandler())),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it("still sets the Retry-After header on every blocked call, sampling only affects the log line", async () => {
    const interceptor = new IdentifierFailureThrottleInterceptor(fakeReflector(fixedTracker), fakeStorage());
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const context = fakeContext("AuthController", "login");

    await expect(lastValueFrom(await interceptor.intercept(context, fakeCallHandler()))).rejects.toBeInstanceOf(
      ThrottlerException,
    );

    const response = context.switchToHttp().getResponse<{ setHeader: ReturnType<typeof vi.fn> }>();
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", 900);

    vi.restoreAllMocks();
  });
});
