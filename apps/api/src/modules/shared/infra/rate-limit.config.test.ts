import type { ThrottlerModuleOptions, ThrottlerOptions, ThrottlerStorage } from "@nestjs/throttler";
import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service";
import {
  buildThrottlerModuleOptions,
  DEFAULT_IP_LIMIT,
  DEFAULT_THROTTLER,
  DEFAULT_WINDOW_MS,
  EFFECTIVE_MODERATE_IP_LIMIT,
  EFFECTIVE_STRICT_IP_LIMIT,
  MODERATE_IP_LIMIT,
  MODERATE_IP_THROTTLER,
  MODERATE_WINDOW_MS,
  NO_IDENTIFIER_TRACKER,
  STRICT_IP_LIMIT,
  STRICT_IP_THROTTLER,
  STRICT_WINDOW_MS,
  trackByBodyField,
  trackByParam,
} from "./rate-limit.config";

/** Minimal stand-in for `AppConfigService` — only `.nodeEnv` is read by
 * `buildThrottlerModuleOptions`. Cast through `unknown`, same documented pattern the
 * exception filter's own test file uses for `PinoLogger`. */
function fakeAppConfig(nodeEnv: "development" | "test" | "production"): AppConfigService {
  return { nodeEnv } as unknown as AppConfigService;
}

/** `buildThrottlerModuleOptions` always returns the OBJECT form (`{ throttlers, storage }`)
 * — never the bare-array form `ThrottlerModuleOptions` also allows — this narrows that for
 * every test below instead of repeating an `Array.isArray` guard in each one. */
function throttlersOf(options: ThrottlerModuleOptions): ThrottlerOptions[] {
  if (Array.isArray(options)) {
    throw new Error("expected the object form with `throttlers`, not the bare-array form");
  }
  return options.throttlers;
}

function tierNamed(options: ThrottlerModuleOptions, name: string): ThrottlerOptions {
  const tier = throttlersOf(options).find((t) => t.name === name);
  if (!tier) {
    throw new Error(`no throttler tier named "${name}"`);
  }
  return tier;
}

/** A `ThrottlerStorage` stub that's never actually called in these tests — only used to
 * assert identity (`options.storage === storage`), so no real implementation is needed. */
function fakeStorage(): ThrottlerStorage {
  return { increment: () => Promise.resolve({} as never) };
}

describe("buildThrottlerModuleOptions", () => {
  it("registers exactly the three ThrottlerGuard-managed tiers — default, strictIp, moderateIp (strictIdentifier is NOT one of them, see IdentifierFailureThrottleInterceptor)", () => {
    const options = buildThrottlerModuleOptions(fakeAppConfig("production"), fakeStorage());
    const names = throttlersOf(options).map((t) => t.name).sort();

    expect(names).toEqual([DEFAULT_THROTTLER, MODERATE_IP_THROTTLER, STRICT_IP_THROTTLER].sort());
  });

  it("uses a generous, real DEFAULT_IP_LIMIT for the global default tier outside NODE_ENV=test", () => {
    for (const nodeEnv of ["development", "production"] as const) {
      const options = buildThrottlerModuleOptions(fakeAppConfig(nodeEnv), fakeStorage());

      expect(tierNamed(options, DEFAULT_THROTTLER)).toMatchObject({
        limit: DEFAULT_IP_LIMIT,
        ttl: DEFAULT_WINDOW_MS,
        setHeaders: false,
      });
    }
  });

  it("strictIp/moderateIp have an INERT (very high) base limit outside a per-route @Throttle() override", () => {
    const options = buildThrottlerModuleOptions(fakeAppConfig("production"), fakeStorage());

    const strictIp = tierNamed(options, STRICT_IP_THROTTLER);
    const moderateIp = tierNamed(options, MODERATE_IP_THROTTLER);

    // Inert = comfortably above anything a real route would ever configure, so a route
    // that forgets to `@Throttle()` this tier down never gets meaningfully limited by it.
    expect(strictIp.limit).toBeGreaterThan(100_000);
    expect(moderateIp.limit).toBeGreaterThan(100_000);
    expect(strictIp).toMatchObject({ ttl: STRICT_WINDOW_MS, setHeaders: false });
    expect(moderateIp).toMatchObject({ ttl: MODERATE_WINDOW_MS, setHeaders: false });
  });

  it("scales the default tier's limit up in NODE_ENV=test, so repeated happy-path integration test runs never spuriously 429", () => {
    const options = buildThrottlerModuleOptions(fakeAppConfig("test"), fakeStorage());

    expect(tierNamed(options, DEFAULT_THROTTLER).limit).toBeGreaterThan(DEFAULT_IP_LIMIT * 100);
    // The window itself never changes — only the limit is scaled.
    expect(tierNamed(options, DEFAULT_THROTTLER).ttl).toBe(DEFAULT_WINDOW_MS);
  });

  it("threads the given storage through untouched", () => {
    const storage = fakeStorage();
    const options = buildThrottlerModuleOptions(fakeAppConfig("production"), storage);
    if (Array.isArray(options)) {
      throw new Error("expected the object form with `storage`");
    }
    expect(options.storage).toBe(storage);
  });
});

describe("EFFECTIVE_STRICT_IP_LIMIT / EFFECTIVE_MODERATE_IP_LIMIT (decorator-time test multiplier)", () => {
  // Vitest sets `process.env.NODE_ENV = "test"` before any module loads (same reason
  // `AppConfigService.nodeEnv` resolves to `"test"` in every integration test regardless of
  // the root `.env`) — so by the time THIS test file's `import` of `rate-limit.config.ts`
  // above ran, `DECORATOR_TIME_MULTIPLIER` was already computed against `"test"`.
  it("are scaled up relative to the raw production numbers, since this whole suite runs under NODE_ENV=test", () => {
    expect(EFFECTIVE_STRICT_IP_LIMIT).toBeGreaterThan(STRICT_IP_LIMIT * 100);
    expect(EFFECTIVE_MODERATE_IP_LIMIT).toBeGreaterThan(MODERATE_IP_LIMIT * 100);
  });
});

describe("trackByBodyField", () => {
  it("returns a lowercased, trimmed body field value prefixed for namespacing", async () => {
    const tracker = trackByBodyField("email");
    const value = await tracker({ body: { email: "  Someone@Example.COM  " } }, {} as never);
    expect(value).toBe("body.email:someone@example.com");
  });

  it("falls back to the shared NO_IDENTIFIER_TRACKER when the field is missing", async () => {
    const tracker = trackByBodyField("email");
    expect(await tracker({ body: {} }, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
    expect(await tracker({}, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
  });

  it("falls back when the field is present but blank/non-string", async () => {
    const tracker = trackByBodyField("email");
    expect(await tracker({ body: { email: "   " } }, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
    expect(await tracker({ body: { email: 123 } }, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
  });

  it("two different e-mails produce two different tracker values (no accidental bucket sharing)", async () => {
    const tracker = trackByBodyField("email");
    const a = await tracker({ body: { email: "a@example.test" } }, {} as never);
    const b = await tracker({ body: { email: "b@example.test" } }, {} as never);
    expect(a).not.toBe(b);
  });
});

describe("trackByParam", () => {
  it("returns the raw param value prefixed for namespacing (no case-folding — tokens are opaque)", async () => {
    const tracker = trackByParam("token");
    const value = await tracker({ params: { token: "AbC123" } }, {} as never);
    expect(value).toBe("param.token:AbC123");
  });

  it("falls back to NO_IDENTIFIER_TRACKER when the param is missing/blank", async () => {
    const tracker = trackByParam("token");
    expect(await tracker({ params: {} }, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
    expect(await tracker({}, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
    expect(await tracker({ params: { token: "" } }, {} as never)).toBe(NO_IDENTIFIER_TRACKER);
  });
});
