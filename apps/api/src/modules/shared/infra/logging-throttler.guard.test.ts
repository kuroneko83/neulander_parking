import type { ExecutionContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ThrottlerLimitDetail, ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { LoggingThrottlerGuard, maskTracker } from "./logging-throttler.guard";

/** Minimal stand-in for a `Response` — only `setHeader` is read by
 * `LoggingThrottlerGuard.throwThrottlingException`'s round-2 security-review fix (the
 * `Retry-After` header, set explicitly since `setHeaders: false` also suppresses it in the
 * base class — see that method's own doc comment). */
function fakeResponse(): { setHeader: ReturnType<typeof vi.fn> } {
  return { setHeader: vi.fn() };
}

/** Minimal stand-in for `ExecutionContext` — only `getClass()`/`getHandler()`/`switchToHttp()`
 * are read by `LoggingThrottlerGuard.throwThrottlingException`. */
function fakeContext(
  className: string,
  handlerName: string,
  response: { setHeader: ReturnType<typeof vi.fn> } = fakeResponse(),
): ExecutionContext {
  return {
    getClass: () => ({ name: className }) as never,
    getHandler: () => ({ name: handlerName }) as never,
    switchToHttp: () => ({
      getResponse: () => response as unknown as Response,
    }),
  } as unknown as ExecutionContext;
}

function fakeDetail(overrides: Partial<ThrottlerLimitDetail> = {}): ThrottlerLimitDetail {
  return {
    limit: 1,
    ttl: 1000,
    key: "opaque-hash",
    tracker: "203.0.113.42",
    totalHits: 2,
    timeToExpire: 10,
    isBlocked: true,
    timeToBlockExpire: 10,
    ...overrides,
  };
}

/** Exposes the `protected` method under test without a real Nest DI container — same
 * "cast through unknown" pattern this codebase already uses elsewhere for testing a
 * protected/private member directly (see `rate-limit.config.test.ts`'s own doc comment). */
function throwThrottlingExceptionOf(
  guard: LoggingThrottlerGuard,
): (context: ExecutionContext, detail: ThrottlerLimitDetail) => Promise<void> {
  return (
    guard as unknown as {
      throwThrottlingException: (context: ExecutionContext, detail: ThrottlerLimitDetail) => Promise<void>;
    }
  ).throwThrottlingException.bind(guard);
}

describe("LoggingThrottlerGuard", () => {
  it("logs a masked warn line with the route label and still throws ThrottlerException when blocked", async () => {
    const options: ThrottlerModuleOptions = { throttlers: [] };
    const storage = { increment: vi.fn() } as unknown as ThrottlerStorage;
    const guard = new LoggingThrottlerGuard(options, storage, new Reflector());
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain("AuthController.login");
    expect(message).toContain("203.0.113.*");
    expect(message).not.toContain("203.0.113.42");

    warnSpy.mockRestore();
  });

  it("round-4 security-review fix (MEDIUM): samples the block warn per route — a burst of blocked requests against the SAME route logs only once per window, with a suppressed count noted", async () => {
    const options: ThrottlerModuleOptions = { throttlers: [] };
    const storage = { increment: vi.fn() } as unknown as ThrottlerStorage;
    const guard = new LoggingThrottlerGuard(options, storage, new Reflector());
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");

    const baseTime = 1_000_000;
    nowSpy.mockReturnValue(baseTime);
    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);

    nowSpy.mockReturnValue(baseTime + 100);
    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(baseTime + 5_001);
    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const secondMessage = warnSpy.mock.calls[1]?.[0] as string;
    expect(secondMessage).toContain("2");
    expect(secondMessage.toLowerCase()).toContain("suprimid");

    warnSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it("round-4 security-review fix (MEDIUM): a DIFFERENT route's block still logs immediately, unaffected by another route's own sampling window", async () => {
    const options: ThrottlerModuleOptions = { throttlers: [] };
    const storage = { increment: vi.fn() } as unknown as ThrottlerStorage;
    const guard = new LoggingThrottlerGuard(options, storage, new Reflector());
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "login"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      throwThrottlingExceptionOf(guard)(fakeContext("AuthController", "register"), fakeDetail()),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it("round-2 security-review fix (MEDIUM): sets the bare Retry-After header from timeToBlockExpire, independent of setHeaders", async () => {
    const options: ThrottlerModuleOptions = { throttlers: [] };
    const storage = { increment: vi.fn() } as unknown as ThrottlerStorage;
    const guard = new LoggingThrottlerGuard(options, storage, new Reflector());
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const response = fakeResponse();

    await expect(
      throwThrottlingExceptionOf(guard)(
        fakeContext("AuthController", "login", response),
        fakeDetail({ timeToBlockExpire: 42 }),
      ),
    ).rejects.toBeInstanceOf(ThrottlerException);

    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", 42);

    vi.restoreAllMocks();
  });
});

describe("maskTracker", () => {
  it("masks the last octet of an IPv4 tracker", () => {
    expect(maskTracker("203.0.113.42")).toBe("203.0.113.*");
  });

  it("truncates an IPv6 tracker down to its first two groups", () => {
    expect(maskTracker("2001:db8:abcd:1234::1")).toBe("2001:db8::*");
  });

  it("falls back to a hard truncation for anything else, never throwing", () => {
    expect(maskTracker("")).toBe("***");
    expect(maskTracker("no-identifier")).toBe("no-i***");
  });
});
