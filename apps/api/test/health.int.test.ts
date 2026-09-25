/**
 * Integration tests for /health/live and /health/ready — Supertest against a real Nest
 * application (ULTRAPLAN 0.3 Definition of Done: "não mocke o banco/redis para o caso
 * de sucesso").
 *
 * REQUIRES `infra/docker/compose.yml` running (Postgres on host port 5433, Redis on
 * 6379 — see .env / .env.example):
 *
 *   docker compose -f infra/docker/compose.yml up -d postgres redis
 *
 * Full Testcontainers automation lands in ULTRAPLAN 0.10; until then this is the
 * documented manual prerequisite (also noted in vitest.config.int.ts).
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { AppConfigService } from "../src/config/app-config.service";

describe("GET /health/live and /health/ready (real Postgres/Redis from compose)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health/live always returns 200 without checking dependencies", async () => {
    const response = await request(app.getHttpServer()).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
  });

  it("GET /health/ready returns 200 when Postgres and Redis are reachable", async () => {
    const response = await request(app.getHttpServer()).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      details: {
        database: { status: "up" },
        redis: { status: "up" },
      },
    });
  });
});

describe("GET /health/ready (dependency unreachable)", () => {
  // Points at a host/port nothing listens on, instead of tearing down the real
  // Compose services — see the file header and the task's test plan.
  const unreachableAppConfig: Pick<
    AppConfigService,
    | "nodeEnv"
    | "isProduction"
    | "http"
    | "corsOrigins"
    | "logLevel"
    | "databaseUrl"
    | "databasePool"
    | "redisUrl"
  > = {
    nodeEnv: "test",
    isProduction: false,
    http: { port: 0, host: "127.0.0.1" },
    corsOrigins: ["http://localhost:5173"],
    logLevel: "silent",
    databaseUrl: "postgresql://neulander:neulander@127.0.0.1:1/neulander_parking",
    // DatabaseModule's shared pool (ULTRAPLAN 0.4) reads this too now that
    // DatabaseHealthIndicator borrows a connection from it instead of opening its own.
    databasePool: { min: 0, max: 1 },
    redisUrl: "redis://127.0.0.1:1",
  };

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfigService)
      .useValue(unreachableAppConfig)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health/ready returns 503 problem+json when a dependency is unreachable", async () => {
    const response = await request(app.getHttpServer()).get("/health/ready");

    // The global RFC 9457 filter (ProblemDetailsExceptionFilter) reshapes Terminus's
    // ServiceUnavailableException into `{ type, title, status, detail, code, errors }`,
    // with the original per-dependency detail preserved under `errors`.
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      errors: {
        database: { status: "down" },
        redis: { status: "down" },
      },
    });
  }, 10_000);

  it("GET /health/live still returns 200 even though Postgres/Redis are unreachable", async () => {
    const response = await request(app.getHttpServer()).get("/health/live");

    expect(response.status).toBe(200);
  });
});
