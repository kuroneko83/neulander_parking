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

  const requiredVars: (keyof typeof validEnv)[] = ["DATABASE_URL", "REDIS_URL"];

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
});
