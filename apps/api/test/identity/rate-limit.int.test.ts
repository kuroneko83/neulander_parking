/**
 * Integration tests for the ULTRAPLAN 1.6 rate limiter, exercised over real HTTP
 * (Supertest) against a real Nest app + the real Postgres/Redis from
 * `infra/docker/compose.yml`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 *
 * Deliberately a SEPARATE file/describe block from `auth.int.test.ts`/
 * `invitations.int.test.ts` (which stay happy-path only).
 *
 * Two DIFFERENT limiting mechanisms are tested in two DIFFERENT ways here — see
 * `modules/shared/infra/rate-limit.config.ts`'s doc comment for why they're different
 * mechanisms at all:
 *
 *  - `strictIdentifier` (`IdentifierFailureThrottleInterceptor`, security-review fix
 *    blocking #2): its limit/window are RAW constants, read fresh via injected
 *    `AppConfigService` at REQUEST time, never scaled by `NODE_ENV=test` — a per-identifier
 *    bucket only accumulates on a FAILURE, and every test below uses a brand-new e-mail per
 *    case, so there's no cross-run/cross-test accumulation risk to guard against the way
 *    the IP tier has. These tests boot the REAL `AppModule`, unmodified, and hit the REAL
 *    `/v1/auth/{login,register}` and `/v1/invitations/:token/accept` routes directly.
 *  - `strictIp` (still a plain, global `ThrottlerGuard` tier): the REAL routes' `@Throttle()`
 *    overrides use `EFFECTIVE_STRICT_IP_LIMIT` — already scaled up ~500x under
 *    `NODE_ENV=test` (see that constant's own doc comment), so hitting the ACTUAL
 *    production number (30) through `/v1/auth/login` directly isn't practical from an
 *    integration test anymore. Its own describe block below instead wires a THROWAWAY
 *    controller with `@Throttle({ strictIp: { limit: STRICT_IP_LIMIT, ... } })` using the
 *    RAW (non-scaled) constant — same `ThrottlerGuard`/`RedisThrottlerStorage` machinery
 *    real routes use, just not sharing their scaled-up decorator metadata. This is also
 *    where `trust proxy` (security-review fix blocking #1) is exercised, since that's
 *    fundamentally an IP-tracking concern.
 */
import { randomBytes } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Throttle } from "@nestjs/throttler";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { applyGlobalHttpConfig } from "../../src/configure-app";
import {
  LoggingThrottlerGuard,
  SharedModule,
  STRICT_IDENTIFIER_LIMIT,
  STRICT_IP_LIMIT,
  STRICT_IP_THROTTLER,
  STRICT_WINDOW_MS,
} from "../../src/modules/shared";

function freshEmail(label: string): string {
  return `rate-limit-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

describe("strictIdentifier tier (IdentifierFailureThrottleInterceptor, real AppModule, real production numbers)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalHttpConfig(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Round-2 security-review fix (blocking #1 — TOCTOU race): `IdentifierFailureThrottleInterceptor`
   * now calls the SAME atomic `increment()` `strictIp`/`moderateIp` use, BEFORE the handler
   * runs — same "classic pre-handler `ThrottlerGuard`" semantics as the `strictIp` tier's own
   * test below: the `(limit + 1)`-th call itself is the one rejected (immediately, without
   * even reaching the handler), not some later call. Hence looping exactly
   * `STRICT_IDENTIFIER_LIMIT` times before asserting the block on the very next call.
   */
  it(`blocks POST /v1/auth/login with 429 on the ${STRICT_IDENTIFIER_LIMIT + 1}th attempt for the SAME e-mail, RFC 9457 shape + bare Retry-After header`, async () => {
    const email = freshEmail("login-identifier");

    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT; attempt++) {
      const response = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "wrong password" });
      expect(response.status).toBe(401);
    }

    const blocked = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "wrong password" });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      type: "about:blank",
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it(`round-2 security-review fix (blocking #1 — TOCTOU race): caps a BURST of ${STRICT_IDENTIFIER_LIMIT * 4} CONCURRENT failed attempts against the SAME e-mail at the real limit, not just serial ones`, async () => {
    // This is the exact shape the reviewer used to reproduce the bug against the round-1
    // fix (a read-only `peek()` before the handler): fire every request in parallel via
    // `Promise.all`, not a `for` loop — a race only shows up when requests genuinely overlap
    // in Redis, not when they're serialized by `await` inside the test itself.
    const email = freshEmail("login-identifier-concurrent");
    const burstSize = STRICT_IDENTIFIER_LIMIT * 4;

    const responses = await Promise.all(
      Array.from({ length: burstSize }, () =>
        request(app.getHttpServer()).post("/v1/auth/login").send({ email, password: "wrong password" }),
      ),
    );

    const statusCounts = responses.reduce<Record<number, number>>((counts, response) => {
      counts[response.status] = (counts[response.status] ?? 0) + 1;
      return counts;
    }, {});

    // Every response is either the expected "wrong password" 401 or a 429 — never anything
    // else (e.g. a 500 from a raced Redis call).
    expect(Object.keys(statusCounts).sort()).toEqual(["401", "429"].sort());
    // With an atomic pre-handler increment, AT MOST `STRICT_IDENTIFIER_LIMIT` requests can
    // ever see the handler (and therefore a 401) — the rest MUST be rejected with 429. The
    // round-1 regression this guards against let all `burstSize` requests through as 401,
    // with zero 429s.
    expect(statusCounts[401] ?? 0).toBeLessThanOrEqual(STRICT_IDENTIFIER_LIMIT);
    expect(statusCounts[429] ?? 0).toBeGreaterThanOrEqual(burstSize - STRICT_IDENTIFIER_LIMIT);
  });

  it("security-review fix (blocking #2): a SUCCESSFUL login never contributes to the identifier bucket — many more than the limit in a row, none blocked", async () => {
    const email = freshEmail("login-success-never-counts");
    const password = "correct horse battery staple";
    await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ email, password, name: "Motorista Teste" });

    // Deliberately MORE calls than STRICT_IDENTIFIER_LIMIT — if success incremented the
    // bucket the way the old (pre-fix) design did, this would 429 well before the loop ends.
    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT + 5; attempt++) {
      const response = await request(app.getHttpServer()).post("/v1/auth/login").send({ email, password });
      expect(response.status).toBe(200);
    }
  });

  it("security-review fix (blocking #2): a successful login RESETS an in-progress failure count (extra defense-in-depth on top of 'only count failures')", async () => {
    const email = freshEmail("login-reset-on-success");
    const password = "correct horse battery staple";
    await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ email, password, name: "Motorista Teste" });

    // A few real failures (typos) — comfortably under the limit.
    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT - 1; attempt++) {
      const response = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "wrong password" });
      expect(response.status).toBe(401);
    }

    // Then the correct password — resets the bucket.
    const success = await request(app.getHttpServer()).post("/v1/auth/login").send({ email, password });
    expect(success.status).toBe(200);

    // A FULL fresh round of failures afterward — if the reset hadn't happened, this would
    // already be blocked partway through (only ~2 attempts of "budget" would remain). Loops
    // exactly `STRICT_IDENTIFIER_LIMIT` times (not `+ 1`, see the atomic pre-handler
    // increment's off-by-one, documented on the very first `it()` in this describe block) —
    // the NEXT call is the one that gets blocked.
    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT; attempt++) {
      const response = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "wrong password" });
      expect(response.status).toBe(401);
    }
    const blocked = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "wrong password" });
    expect(blocked.status).toBe(429);
  });

  it("does NOT block a DIFFERENT e-mail from the same IP once one e-mail's bucket is exhausted (per-identifier isolation)", async () => {
    const exhaustedEmail = freshEmail("cross-a");
    const otherEmail = freshEmail("cross-b");

    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT + 1; attempt++) {
      await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: exhaustedEmail, password: "wrong password" });
    }
    const blocked = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: exhaustedEmail, password: "wrong password" });
    expect(blocked.status).toBe(429);

    // Same IP (same supertest agent/process), a DIFFERENT e-mail — must NOT be blocked.
    const otherResponse = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: otherEmail, password: "wrong password" });
    expect(otherResponse.status).toBe(401);
  });

  it(`blocks POST /v1/auth/register with 429 on the ${STRICT_IDENTIFIER_LIMIT + 1}th FAILED (duplicate-e-mail) attempt`, async () => {
    const email = freshEmail("register-identifier");
    const payload = { email, password: "correct horse battery staple", name: "Motorista Teste" };

    // First call succeeds (201) — its own pre-handler increment is immediately reset on
    // success, so it doesn't count against the budget below; every retry after that 409s (a
    // real "failure" for this bucket's purposes).
    const first = await request(app.getHttpServer()).post("/v1/auth/register").send(payload);
    expect(first.status).toBe(201);

    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT; attempt++) {
      const response = await request(app.getHttpServer()).post("/v1/auth/register").send(payload);
      expect(response.status).toBe(409);
    }

    const blocked = await request(app.getHttpServer()).post("/v1/auth/register").send(payload);
    expect(blocked.status).toBe(429);
  });

  it(`blocks POST /v1/invitations/:token/accept with 429 after ${STRICT_IDENTIFIER_LIMIT + 1} attempts for the SAME (bogus) token`, async () => {
    // A fresh random 64-hex-char token per test run (NOT the fixed "0".repeat(64) an
    // earlier version of this test used) — `test/identity/invitations.int.test.ts` also
    // exercises `POST /v1/invitations/:token/accept` with that exact same fixed bogus token,
    // and since the `strictIdentifier` bucket key is derived purely from
    // `(route, token)` (see `IdentifierFailureThrottleInterceptor.buildKey`), both files
    // sharing one fixed token collide on the SAME Redis bucket when run together in the
    // full `pnpm test:int` suite (real Redis, both files' requests count toward the same
    // limit) — flaky/failing depending on run order/parallelism. A random token per run
    // gives this test its own isolated bucket every time, the same way `freshEmail()` does
    // for the e-mail-keyed tests above.
    const bogusToken = randomBytes(32).toString("hex");

    for (let attempt = 1; attempt <= STRICT_IDENTIFIER_LIMIT; attempt++) {
      const response = await request(app.getHttpServer())
        .post(`/v1/invitations/${bogusToken}/accept`)
        .send({});
      expect(response.status).not.toBe(429);
    }

    const blocked = await request(app.getHttpServer())
      .post(`/v1/invitations/${bogusToken}/accept`)
      .send({});

    expect(blocked.status).toBe(429);
  });

  it("moderate tier: POST /v1/auth/refresh never trips the strict per-e-mail tier — there's no e-mail in play at all", async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: "this-token-was-never-issued" });
      expect(response.status).toBe(401);
    }
  });
});

/**
 * `strictIp` (still a plain `ThrottlerGuard` tier) + `trust proxy` (security-review fix
 * blocking #1) — a THROWAWAY controller wired with the RAW (non-`NODE_ENV=test`-scaled)
 * production constants, so the exact numeric threshold is directly testable. See this
 * file's own header comment for why the REAL `/v1/auth/login` route can't be used for this
 * specific assertion anymore.
 *
 * `@UseGuards(LoggingThrottlerGuard)` — NOT the bare `ThrottlerGuard` an earlier version of
 * this probe used: round-2 security-review fix (MEDIUM, `Retry-After` on `strictIp`/
 * `moderateIp`) lives in `LoggingThrottlerGuard.throwThrottlingException`, an override the
 * bare base class doesn't have. Production's real `strictIp` routes are protected by
 * `LoggingThrottlerGuard` too (the global `APP_GUARD` in `app.module.ts`) — using the same
 * subclass here is what makes the `Retry-After` assertion below actually prove anything
 * about production behavior, instead of exercising a guard no real route uses.
 */
@Controller("__test-strict-ip-probe")
class StrictIpProbeController {
  @Get()
  @UseGuards(LoggingThrottlerGuard)
  @Throttle({ [STRICT_IP_THROTTLER]: { limit: STRICT_IP_LIMIT, ttl: STRICT_WINDOW_MS } })
  probe(): { ok: true } {
    return { ok: true };
  }
}

/** A fresh, effectively-never-collides synthetic IPv4 address per call — only ever used as
 * an opaque `X-Forwarded-For` tracker string, never actually connected to, so it doesn't
 * need to be a "real"/reserved-block address; the private `10.0.0.0/8` range just gives
 * ~16M possible values for cheap collision avoidance. Used as the rightmost
 * (trusted-hop-appended) value in every `strictIp` test below. `STRICT_WINDOW_MS` is 15
 * minutes and `blockDuration` matches it — without a fresh IP per test RUN (not just per
 * `it()`, since re-running `pnpm test:int` repeatedly during development happens within
 * that same window against the same real Redis), a previous run's block/hit-count would
 * still be active and make these count-based assertions flaky/wrong. */
function freshSyntheticIp(): string {
  const octet = () => Math.floor(Math.random() * 256);
  return `10.${octet()}.${octet()}.${octet()}`;
}

describe("strictIp tier + trust proxy (real ThrottlerGuard/RedisThrottlerStorage, raw production STRICT_IP_LIMIT)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SharedModule],
      controllers: [StrictIpProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    // Critical for the XFF tests below — this is the exact same call `main.ts`/every real
    // integration test makes, applying `trust proxy: 1` (security-review fix blocking #1).
    applyGlobalHttpConfig(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`blocks with 429 after exactly ${STRICT_IP_LIMIT} requests from the same IP (classic pre-handler ThrottlerGuard semantics — the (limit+1)-th call itself is the one rejected), and the 429 carries a bare Retry-After header`, async () => {
    // A fresh synthetic IP per test RUN (not a real/no-XFF request) — see
    // `freshSyntheticIp()`'s own doc comment for why plain loopback would make this flaky
    // across repeated `pnpm test:int` runs within the same 15-minute window.
    const ip = freshSyntheticIp();

    for (let attempt = 1; attempt <= STRICT_IP_LIMIT; attempt++) {
      const response = await request(app.getHttpServer())
        .get("/v1/__test-strict-ip-probe")
        .set("X-Forwarded-For", ip);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .get("/v1/__test-strict-ip-probe")
      .set("X-Forwarded-For", ip);
    expect(blocked.status).toBe(429);
    // Round-2 security-review fix (MEDIUM): `strictIp` sets `setHeaders: false`
    // (`rate-limit.config.ts`) to suppress the `X-RateLimit-*` headers — that used to ALSO
    // suppress the bare `Retry-After` header in the installed `@nestjs/throttler` version,
    // until `LoggingThrottlerGuard.throwThrottlingException` started setting it explicitly.
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("security-review fix (blocking #1): a spoofed leftmost X-Forwarded-For entry is IGNORED — only the rightmost (the hop trust proxy=1 actually trusts) determines the bucket", async () => {
    // Same REAL (rightmost) hop every time, a DIFFERENT attacker-chosen leftmost value each
    // request — with `trust proxy: 1`, Express resolves `req.ip` to the RIGHTMOST entry
    // only, so every one of these must land in the SAME bucket regardless of what the
    // "attacker" prepends.
    const sharedRealHop = freshSyntheticIp();

    for (let attempt = 1; attempt <= STRICT_IP_LIMIT; attempt++) {
      const response = await request(app.getHttpServer())
        .get("/v1/__test-strict-ip-probe")
        .set("X-Forwarded-For", `attacker-spoofed-value-${attempt}-${Math.random()}, ${sharedRealHop}`);
      expect(response.status).toBe(200);
    }

    // The (limit+1)-th request — STILL varying the spoofed leftmost part — must now be
    // blocked, proving all previous requests landed in the SAME bucket (keyed off the
    // shared rightmost hop), not a fresh one each time.
    const blocked = await request(app.getHttpServer())
      .get("/v1/__test-strict-ip-probe")
      .set("X-Forwarded-For", `attacker-spoofed-value-final-${Math.random()}, ${sharedRealHop}`);
    expect(blocked.status).toBe(429);
  });

  it("security-review fix (blocking #1): genuinely different rightmost (trusted-hop-appended) IPs get ISOLATED buckets, never trip each other's limit", async () => {
    // Each request claims a DIFFERENT (fresh, synthetic) real client IP, as if a real proxy
    // legitimately appended a different client's address each time — none of these should
    // ever accumulate into a shared bucket, however many are sent.
    for (let attempt = 1; attempt <= STRICT_IP_LIMIT + 5; attempt++) {
      const response = await request(app.getHttpServer())
        .get("/v1/__test-strict-ip-probe")
        .set("X-Forwarded-For", `some-spoofed-prefix, ${freshSyntheticIp()}`);
      expect(response.status).toBe(200);
    }
  });
});
