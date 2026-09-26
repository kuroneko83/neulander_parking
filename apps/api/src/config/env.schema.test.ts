import { describe, expect, it } from "vitest";

import { validateEnv } from "./env.schema";

const validEnv = {
  NODE_ENV: "development",
  API_PORT: "3000",
  API_HOST: "0.0.0.0",
  CORS_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "info",
  DATABASE_URL: "postgresql://neulander:neulander@localhost:5433/neulander_parking",
  REDIS_URL: "redis://localhost:6379",
  // Fake but correctly-shaped PEM blocks — this schema only checks the markers, never
  // parses real RSA key material (that's `jsonwebtoken`'s job at sign/verify time).
  JWT_ACCESS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----",
  JWT_ACCESS_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: "30",
  PASSWORD_PEPPER: "test-pepper-at-least-32-characters-long",
};

describe("validateEnv", () => {
  it("accepts a fully valid environment and coerces/transforms values", () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3000);
    expect(typeof env.API_PORT).toBe("number");
    expect(env.CORS_ORIGIN).toEqual(["http://localhost:5173"]);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validEnv.REDIS_URL);
  });

  it("splits and trims a comma-separated CORS_ORIGIN into an array", () => {
    const env = validateEnv({
      ...validEnv,
      CORS_ORIGIN: "http://localhost:5173, https://painel.example.com ,http://localhost:3001",
    });

    expect(env.CORS_ORIGIN).toEqual([
      "http://localhost:5173",
      "https://painel.example.com",
      "http://localhost:3001",
    ]);
  });

  it("applies defaults for NODE_ENV, API_PORT, API_HOST, CORS_ORIGIN and LOG_LEVEL when omitted", () => {
    // Underscore-prefixed bindings are destructured only to omit these keys from `rest`
    // (varsIgnorePattern: "^_" in the shared eslint config — see @neulander/config).
    const {
      NODE_ENV: _n,
      API_PORT: _p,
      API_HOST: _h,
      CORS_ORIGIN: _c,
      LOG_LEVEL: _l,
      ...rest
    } = validEnv;

    const env = validateEnv(rest);

    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3333);
    expect(env.API_HOST).toBe("0.0.0.0");
    expect(env.CORS_ORIGIN).toEqual(["http://localhost:5173"]);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("applies defaults for DATABASE_POOL_MIN/MAX when omitted", () => {
    const env = validateEnv(validEnv);

    expect(env.DATABASE_POOL_MIN).toBe(2);
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  const requiredVars: (keyof typeof validEnv)[] = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_PRIVATE_KEY",
    "JWT_ACCESS_PUBLIC_KEY",
    "PASSWORD_PEPPER",
  ];

  it.each(requiredVars)("throws a clear error when %s is missing", (key) => {
    const { [key]: _omitted, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/Configuração de ambiente inválida/);
    try {
      validateEnv(rest);
      expect.unreachable("validateEnv deveria lançar");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(key);
    }
  });

  it("throws when API_PORT is not a number", () => {
    expect(() => validateEnv({ ...validEnv, API_PORT: "not-a-number" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });

  it.each([0, -1, 70000, 65536])("throws when API_PORT is out of range (%d)", (port) => {
    expect(() => validateEnv({ ...validEnv, API_PORT: String(port) })).toThrow();
  });

  it("throws when NODE_ENV has an unexpected value", () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow();
  });

  it("throws when DATABASE_URL does not look like a Postgres connection string", () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: "mysql://localhost/db" })).toThrow();
  });

  it("throws when REDIS_URL does not look like a Redis connection string", () => {
    expect(() => validateEnv({ ...validEnv, REDIS_URL: "http://localhost:6379" })).toThrow();
  });

  it("throws when CORS_ORIGIN is an empty string", () => {
    expect(() => validateEnv({ ...validEnv, CORS_ORIGIN: "" })).toThrow();
  });

  it("applies defaults for JWT_ACCESS_TTL/JWT_REFRESH_TTL_DAYS when omitted", () => {
    const { JWT_ACCESS_TTL: _t, JWT_REFRESH_TTL_DAYS: _d, ...rest } = validEnv;

    const env = validateEnv(rest);

    expect(env.JWT_ACCESS_TTL).toBe("15m");
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
  });

  it("coerces JWT_REFRESH_TTL_DAYS to a number", () => {
    const env = validateEnv(validEnv);

    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
    expect(typeof env.JWT_REFRESH_TTL_DAYS).toBe("number");
  });

  it("throws when JWT_ACCESS_PRIVATE_KEY doesn't look like a PEM private key", () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_PRIVATE_KEY: "not-a-pem-key" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });

  it("throws when JWT_ACCESS_PUBLIC_KEY doesn't look like a PEM public key", () => {
    expect(() => validateEnv({ ...validEnv, JWT_ACCESS_PUBLIC_KEY: "not-a-pem-key" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });

  it.each(["15", "fifteen", "15 minutes", ""])(
    "throws when JWT_ACCESS_TTL is not a valid `ms`-style duration (%s)",
    (value) => {
      expect(() => validateEnv({ ...validEnv, JWT_ACCESS_TTL: value })).toThrow();
    },
  );

  it("throws when PASSWORD_PEPPER is an empty string", () => {
    expect(() => validateEnv({ ...validEnv, PASSWORD_PEPPER: "" })).toThrow();
  });

  it("throws when PASSWORD_PEPPER is shorter than 32 characters", () => {
    expect(() => validateEnv({ ...validEnv, PASSWORD_PEPPER: "short-pepper" })).toThrow();
  });

  it("accepts PASSWORD_PEPPER at the 32-character boundary", () => {
    expect(() =>
      validateEnv({ ...validEnv, PASSWORD_PEPPER: "x".repeat(32) }),
    ).not.toThrow();
  });
});
