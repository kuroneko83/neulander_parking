/**
 * Integration tests for `POST /v1/auth/{register,login,refresh,logout}` (ULTRAPLAN 1.3) and
 * `GET /v1/me` + `JwtAuthGuard` (ULTRAPLAN 1.4) — Supertest against a real Nest application
 * and the real Postgres from `infra/docker/compose.yml`, same style as
 * `test/health.int.test.ts`/`test/shared/outbox.int.test.ts`:
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 *
 * Requires REAL RS256 keys in the root `.env` (`JWT_ACCESS_PRIVATE_KEY`/
 * `JWT_ACCESS_PUBLIC_KEY`) — the `.env.example` "CHANGE_ME" placeholders are not valid PEM
 * key material and signing will fail against them (see the task's own verification
 * instructions for generating a real pair with `openssl`).
 */
import { createHash } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { applyGlobalHttpConfig } from "../../src/configure-app";
import type { Database } from "../../src/database/database.module";
import { DATABASE_CONNECTION } from "../../src/database/database.module";
import { DEMO_SEED_PASSWORD, seedIdentity } from "../../src/modules/identity";
import { refreshTokens, users } from "../../src/modules/identity/infra/schema";

/** Decodes a JWT's payload without verifying the signature — good enough to assert on
 * claims in a test; the fact that `LoginUseCase`/`RefreshTokenUseCase` produced a token
 * that a real `jsonwebtoken`-based verifier accepts is exercised implicitly by every other
 * assertion here running against the real `AuthJwtService` (RS256, real keys from `.env`).
 * No extra dependency needed for this — a JWT's payload segment is just base64url JSON. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payloadSegment] = token.split(".");
  if (!payloadSegment) {
    throw new Error(`Não parece um JWT: "${token}"`);
  }
  return JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("auth: register, login, refresh, logout, /v1/me (real Postgres from compose)", () => {
  let app: INestApplication;
  let db: Database;
  const emailsToCleanUp: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalHttpConfig(app);
    await app.init();

    db = app.get(DATABASE_CONNECTION);
  });

  afterAll(async () => {
    for (const email of emailsToCleanUp) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (user) {
        await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
      }
    }
    await app.close();
  });

  function uniqueEmail(label: string): string {
    const email = `auth-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    emailsToCleanUp.push(email);
    return email;
  }

  describe("register", () => {
    it("201s and creates a driver user with a hashed password", async () => {
      const email = uniqueEmail("register-ok");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password: "correct horse battery staple", name: "Motorista Teste" });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ id: expect.any(String) });

      const [row] = await db.select().from(users).where(eq(users.email, email));
      expect(row).toBeDefined();
      expect(row?.roleGlobal).toBe("driver");
      expect(row?.passwordHash).not.toBe("correct horse battery staple");
      expect(row?.passwordHash?.startsWith("$argon2id$")).toBe(true);
    });

    it("409s with EMAIL_ALREADY_REGISTERED for a duplicate e-mail", async () => {
      const email = uniqueEmail("register-dup");
      const payload = { email, password: "correct horse battery staple", name: "Motorista Teste" };

      const first = await request(app.getHttpServer()).post("/v1/auth/register").send(payload);
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer()).post("/v1/auth/register").send(payload);
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({
        status: 409,
        code: "EMAIL_ALREADY_REGISTERED",
      });
    });

    it("400s (Zod DTO validation, before the use case runs) for a password shorter than 8 chars", async () => {
      const email = uniqueEmail("register-weak-password");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password: "short", name: "Motorista Teste" });

      expect(response.status).toBe(400);

      const [row] = await db.select().from(users).where(eq(users.email, email));
      expect(row).toBeUndefined();
    });
  });

  describe("login", () => {
    const password = "correct horse battery staple";

    async function registerUser(label: string): Promise<{ email: string; id: string }> {
      const email = uniqueEmail(label);
      const response = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password, name: "Motorista Teste" });
      return { email, id: (response.body as { id: string }).id };
    }

    it("returns a valid TokenPair with the expected claims for correct credentials", async () => {
      const { email, id } = await registerUser("login-ok");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });

      const claims = decodeJwtPayload((response.body as { accessToken: string }).accessToken);
      expect(claims["sub"]).toBe(id);
      expect(claims["roleGlobal"]).toBe("driver");
      expect(claims["roles"]).toEqual([]);
      expect(typeof claims["exp"]).toBe("number");

      // ADR-0004: web also gets the refresh token as an `HttpOnly` cookie. Node's raw
      // response keeps `set-cookie` as a string array, but the `@types/superagent` typing
      // supertest's `Response.headers` uses declares every header as a plain `string` — so
      // this normalizes to an array at runtime regardless of what the type says.
      const rawSetCookie = response.headers["set-cookie"] as unknown as
        string[] | string | undefined;
      const setCookieValues = Array.isArray(rawSetCookie)
        ? rawSetCookie
        : rawSetCookie
          ? [rawSetCookie]
          : [];
      expect(setCookieValues.some((cookie) => cookie.startsWith("refresh_token="))).toBe(true);
      expect(setCookieValues.some((cookie) => /HttpOnly/i.test(cookie))).toBe(true);
    });

    it("returns the exact same error for a wrong password and a non-existent e-mail", async () => {
      const { email } = await registerUser("login-wrong-password");

      const wrongPassword = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "not the right password" });

      const noSuchEmail = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: `nobody-${Date.now()}@example.test`, password: "irrelevant" });

      expect(wrongPassword.status).toBe(401);
      expect(noSuchEmail.status).toBe(401);
      expect(wrongPassword.body).toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect(noSuchEmail.body).toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect(wrongPassword.body).toEqual(noSuchEmail.body);
    });

    // Regression test for a real bug caught in code review: `seedIdentity` (ULTRAPLAN 1.2)
    // originally hashed `DEMO_SEED_PASSWORD` with plain `argon2.hash(...)` (no `secret`),
    // while `PasswordHasher.verify` (ULTRAPLAN 1.3) always verifies with
    // `{ secret: PASSWORD_PEPPER }` — a hash computed without the pepper can never verify
    // with it, so every seeded demo account was silently locked out of `POST
    // /v1/auth/login` the moment this task shipped. `seed.int.test.ts` didn't catch this
    // because it called `argon2.verify` directly, without a pepper, bypassing
    // `PasswordHasher` entirely. This test goes through the real HTTP login path instead.
    it("logs in as a seeded demo account (admin@neulander.dev) with the documented demo password", async () => {
      await seedIdentity(db);

      const response = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: "admin@neulander.dev", password: DEMO_SEED_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });

      const claims = decodeJwtPayload((response.body as { accessToken: string }).accessToken);
      expect(claims["roleGlobal"]).toBe("platform_admin");
    });
  });

  describe("refresh", () => {
    const password = "correct horse battery staple";

    async function loginFreshUser(
      label: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
      const email = uniqueEmail(label);
      await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password, name: "Motorista Teste" });
      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password });
      return login.body as { accessToken: string; refreshToken: string };
    }

    it("rotates: issues a new pair, marks the old token revoked, and the new token works", async () => {
      const { refreshToken: originalToken } = await loginFreshUser("refresh-rotate");

      const [originalRow] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashForTest(originalToken)));
      expect(originalRow).toBeDefined();
      expect(originalRow?.revokedAt).toBeNull();

      const response = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: originalToken });

      expect(response.status).toBe(200);
      const { accessToken, refreshToken: newToken } = response.body as {
        accessToken: string;
        refreshToken: string;
      };
      expect(newToken).not.toBe(originalToken);
      expect(typeof decodeJwtPayload(accessToken)["sub"]).toBe("string");

      const [revokedRow] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashForTest(originalToken)));
      expect(revokedRow?.revokedAt).not.toBeNull();

      const [newRow] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashForTest(newToken)));
      expect(newRow).toBeDefined();
      expect(newRow?.revokedAt).toBeNull();
      expect(newRow?.familyId).toBe(originalRow?.familyId);

      // The rotated (now-current) token itself still works for a follow-up refresh.
      const secondRefresh = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: newToken });
      expect(secondRefresh.status).toBe(200);
    });

    it("reuse of an already-rotated token fails AND revokes the whole family (including the current valid token)", async () => {
      const { refreshToken: originalToken } = await loginFreshUser("refresh-reuse");

      const firstRefresh = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: originalToken });
      expect(firstRefresh.status).toBe(200);
      const { refreshToken: currentValidToken } = firstRefresh.body as { refreshToken: string };

      const [currentRowBefore] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashForTest(currentValidToken)));
      expect(currentRowBefore?.revokedAt).toBeNull();

      // Reuse: presenting the ORIGINAL (already-rotated-away) token again.
      const reuseAttempt = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: originalToken });

      expect(reuseAttempt.status).toBe(401);
      expect(reuseAttempt.body).toMatchObject({ code: "REFRESH_TOKEN_REUSE_DETECTED" });

      // The whole family is revoked — including `currentValidToken`, which was valid and
      // unused right up until the reuse was detected.
      const [currentRowAfter] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashForTest(currentValidToken)));
      expect(currentRowAfter?.revokedAt).not.toBeNull();

      // And it's now unusable for a real refresh, too.
      const attemptWithRevokedCurrent = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: currentValidToken });
      expect(attemptWithRevokedCurrent.status).toBe(401);
      expect(attemptWithRevokedCurrent.body).toMatchObject({
        code: "REFRESH_TOKEN_REUSE_DETECTED",
      });
    });

    it("401s a token that never existed", async () => {
      const response = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: "this-token-was-never-issued" });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: "REFRESH_TOKEN_INVALID" });
    });

    it("401s when neither a body refreshToken nor a cookie is presented", async () => {
      const response = await request(app.getHttpServer()).post("/v1/auth/refresh").send({});

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: "REFRESH_TOKEN_INVALID" });
    });

    it("accepts the refresh token via the HttpOnly cookie (web flow) instead of the body", async () => {
      const { refreshToken } = await loginFreshUser("refresh-via-cookie");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .set("Cookie", [`refresh_token=${refreshToken}`])
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe("GET /v1/me (JwtAuthGuard)", () => {
    const password = "correct horse battery staple";

    async function registerAndLogin(
      label: string,
    ): Promise<{ email: string; id: string; accessToken: string }> {
      const email = uniqueEmail(label);
      const register = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password, name: "Motorista Teste" });
      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password });
      return {
        email,
        id: (register.body as { id: string }).id,
        accessToken: (login.body as { accessToken: string }).accessToken,
      };
    }

    it("401s without an Authorization header", async () => {
      const response = await request(app.getHttpServer()).get("/v1/me");

      expect(response.status).toBe(401);
    });

    it("401s with a malformed/garbage Bearer token", async () => {
      const response = await request(app.getHttpServer())
        .get("/v1/me")
        .set("Authorization", "Bearer not-a-real-jwt");

      expect(response.status).toBe(401);
    });

    it("200s with the caller's own profile for a driver with no memberships", async () => {
      const { email, id, accessToken } = await registerAndLogin("me-driver");

      const response = await request(app.getHttpServer())
        .get("/v1/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id,
        email,
        name: "Motorista Teste",
        roleGlobal: "driver",
        memberships: [],
      });
    });

    it("200s with memberships for a seeded org member (gestor)", async () => {
      await seedIdentity(db);

      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: "gestor@estacionamento-demo.neulander.dev", password: DEMO_SEED_PASSWORD });
      const { accessToken } = login.body as { accessToken: string };
      const claims = decodeJwtPayload(accessToken) as {
        roles: { organizationId: string; role: string; parkingLotIds: string[] }[];
      };
      const [expectedMembership] = claims.roles;

      const response = await request(app.getHttpServer())
        .get("/v1/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        email: "gestor@estacionamento-demo.neulander.dev",
        roleGlobal: null,
        memberships: [
          {
            organizationId: expectedMembership?.organizationId,
            role: "manager",
            parkingLotIds: [],
          },
        ],
      });
    });
  });

  describe("POST /v1/auth/logout (JwtAuthGuard)", () => {
    const password = "correct horse battery staple";

    async function registerAndLogin(
      label: string,
    ): Promise<{ accessToken: string; refreshToken: string }> {
      const email = uniqueEmail(label);
      await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({ email, password, name: "Motorista Teste" });
      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password });
      return login.body as { accessToken: string; refreshToken: string };
    }

    it("401s without an Authorization header", async () => {
      const response = await request(app.getHttpServer()).post("/v1/auth/logout").send({});

      expect(response.status).toBe(401);
    });

    it("204s and revokes the presented refresh token's whole family", async () => {
      const { accessToken, refreshToken } = await registerAndLogin("logout-ok");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken });

      expect(response.status).toBe(204);

      // The revoked token no longer works for a refresh — same signal reuse detection
      // itself produces, since `LogoutUseCase` calls the same `revokeFamily`.
      const refreshAttempt = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken });
      expect(refreshAttempt.status).toBe(401);
    });

    it("clears the refresh_token cookie on the response", async () => {
      const { accessToken, refreshToken } = await registerAndLogin("logout-clears-cookie");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken });

      const rawSetCookie = response.headers["set-cookie"] as unknown as
        string[] | string | undefined;
      const setCookieValues = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie ?? ""];
      expect(
        setCookieValues.some(
          (cookie) => cookie.startsWith("refresh_token=") && /Expires=Thu, 01 Jan 1970/i.test(cookie),
        ),
      ).toBe(true);
    });

    it("204s (idempotent, no oracle) with no refresh token presented at all", async () => {
      const { accessToken } = await registerAndLogin("logout-no-token");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({});

      expect(response.status).toBe(204);
    });

    it("204s (idempotent, no oracle) with an unknown refresh token", async () => {
      const { accessToken } = await registerAndLogin("logout-unknown-token");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken: "this-token-was-never-issued" });

      expect(response.status).toBe(204);
    });

    it("204s (idempotent, no oracle) with a refresh token that belongs to a DIFFERENT user", async () => {
      const caller = await registerAndLogin("logout-cross-user-caller");
      const victim = await registerAndLogin("logout-cross-user-victim");

      const response = await request(app.getHttpServer())
        .post("/v1/auth/logout")
        .set("Authorization", `Bearer ${caller.accessToken}`)
        .send({ refreshToken: victim.refreshToken });

      expect(response.status).toBe(204);

      // The victim's own refresh token is untouched — logging out with someone else's
      // token must never let a caller revoke a session that isn't theirs.
      const victimRefresh = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: victim.refreshToken });
      expect(victimRefresh.status).toBe(200);
    });
  });
});

// Mirrors `domain/opaque-token.ts`'s `hashOpaqueToken` exactly (SHA-256 hex) so
// this test file can look a presented plaintext token up by its stored hash without
// importing across the module boundary from `test/` into `src/modules/identity/domain/`
// (tests are exempt from the eslint boundaries rule, but there's no need to reach for that
// exemption for three lines of `node:crypto`).
function hashForTest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
