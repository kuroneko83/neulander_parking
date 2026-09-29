import type { INestApplication } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import type { Express } from "express";

// Deliberately imported from the pure config file, NOT `modules/shared`'s public
// `index.ts` barrel: that barrel also re-exports `SharedModule` (Nest/Drizzle/BullMQ
// wiring), so importing anything from it — even a plain numeric constant — eagerly
// evaluates `AppConfigModule`/`DatabaseModule` too (they validate `process.env`/build a
// pool at import time; see `problem-details.exception-filter.ts`'s own doc comment for the
// exact same reasoning, applied there to `DomainError`). `configure-app.test.ts` is a pure
// unit test with no `.env` loaded — pulling in that whole graph here broke exactly that.
// `infra/rate-limit.config.ts` has no Nest/Drizzle import of its own (only a type-only
// import of `AppConfigService`), so reaching for it directly is safe.
import { DECORATOR_TIME_MULTIPLIER } from "./modules/shared/infra/rate-limit.config";

/**
 * HTTP-level app configuration shared between the real entrypoint (`main.ts`) and any
 * integration test that builds its own `INestApplication` directly via
 * `Test.createTestingModule({ imports: [AppModule] }).createNestApplication()`
 * (`test/health.int.test.ts`, `test/identity/auth.int.test.ts`, ...). Those tests never
 * call `main.ts`'s `bootstrap()` — they only compile `AppModule` and call `app.init()`
 * themselves — so anything configured by calling a method on the live `app` instance
 * (as opposed to something wired as a Nest provider/module, which `AppModule` already
 * carries into any test that imports it) has to live here and be called from both places.
 * Otherwise an integration test would silently exercise different routes/behavior than
 * the real deployed app — exactly the versioned-prefix mismatch this file exists to avoid.
 */
export function applyGlobalHttpConfig(app: INestApplication): void {
  // Round-2 security-review fix (LOW), round-4 correction (MEDIUM): fail loudly, at
  // startup, instead of silently degrading brute-force protection 500x — see
  // `assertRateLimitMultiplierIsSafeForProduction`'s own doc comment for why this no longer
  // takes `app`/`AppConfigService` at all.
  assertRateLimitMultiplierIsSafeForProduction();

  // ULTRAPLAN 1.6 security-review fix (HIGH): without this, Express's `trust proxy`
  // defaults to `false`, so `req.ip` is always the DIRECT TCP peer — in production
  // (system-design.md §5/§11: ECS Fargate tasks in a private subnet, only reachable
  // through the ALB) that peer is the ALB's own private IP for every single client, so
  // the per-IP rate-limit tier (`modules/shared/infra/rate-limit.config.ts`) collapses
  // into ONE global bucket: ~31 unauthenticated requests to `POST /v1/auth/login` from a
  // single attacker would 429 the entire platform for 15 minutes.
  //
  // `1` (a HOP COUNT), never `true`: `true` trusts an unbounded chain and honors the
  // LEFTMOST `X-Forwarded-For` entry, which is exactly what an external client controls —
  // trivially bypassable by sending a random value per request. `1` instead honors the
  // RIGHTMOST entry (the one hop closest to us), which only the ALB itself can have
  // appended — verified empirically (see the task's own notes): with `trust proxy: 1`, a
  // request carrying `X-Forwarded-For: <attacker-prepended-garbage>, <real-value>` resolves
  // `req.ip` to `<real-value>`, ignoring anything the client prepended; with `true` it
  // resolves to the attacker's own garbage instead. `apps/api/test/identity/rate-limit.int.test.ts`'s
  // "strictIp tier + trust proxy" describe block exercises both cases against the real app.
  //
  // This is a DEPLOY-TOPOLOGY-COUPLED invariant, not just an app setting: it's only correct
  // because the security group only allows the ALB to reach the Fargate task directly (an
  // attacker can't open a raw TCP connection to the task and inject a fake single-entry
  // `X-Forwarded-For` of their own — see system-design.md §5). If that topology ever grows
  // an extra hop (e.g. a CDN in front of the ALB), this `1` needs to become `2`.
  //
  // `app.getHttpAdapter().getInstance()` (NOT typing this function's own `app` param as
  // `NestExpressApplication`): every caller — `main.ts` AND every integration test that
  // builds its own app via `Test.createTestingModule(...).createNestApplication()` — passes
  // a plain `INestApplication`, and changing that at every call site is a much bigger diff
  // than reaching for the underlying Express instance here, the one place that needs it.
  (app.getHttpAdapter().getInstance() as Express).set("trust proxy", 1);

  // ULTRAPLAN 0.3 deferred versioning to "quando o primeiro endpoint real existir" — that's
  // `/v1/auth/register`/`login`/`refresh` (ULTRAPLAN 1.3, api-and-events.md: "REST
  // versionado em `/v1`"). `/health/live`/`/health/ready` are excluded on purpose: they're
  // infra-level liveness/readiness probes (load balancer health checks), not versioned
  // business API — keeping them unprefixed means an ALB/Kubernetes probe config never needs
  // to know the current API version, and it matches `test/health.int.test.ts`'s existing,
  // already-unprefixed paths (no test change needed for those).
  app.setGlobalPrefix("v1", {
    exclude: [
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });
}

/**
 * Round-2 security-review fix (LOW): `DECORATOR_TIME_MULTIPLIER`
 * (`modules/shared/infra/rate-limit.config.ts`) reads `process.env.NODE_ENV` directly, at
 * MODULE-LOAD time, instead of going through `AppConfigService` (this codebase's established
 * pattern everywhere else) — a deliberate, documented exception, needed because
 * `@Throttle({...})` decorator metadata is fixed the moment a controller file is first
 * imported, before any DI container exists to inject a service into. The risk that exception
 * carries: if `NODE_ENV=test` ever leaked into a deployed (production) task definition, the
 * `strictIp`/`moderateIp` limits routes opt into via that constant would silently become
 * 500x looser — brute-force protection quietly disabled, with no startup signal at all.
 *
 * Round-4 security-review correction (MEDIUM) — the round-2 version of this guard checked
 * `appConfig.isProduction && DECORATOR_TIME_MULTIPLIER !== 1`, but both sides derive from the
 * EXACT SAME `process.env.NODE_ENV` in the same process (`DECORATOR_TIME_MULTIPLIER !== 1` ⟺
 * `NODE_ENV === "test"`; `isProduction` ⟺ `NODE_ENV === "production"`) — the two conditions
 * are mutually exclusive BY CONSTRUCTION, so that `throw` branch could never actually fire.
 * The real danger scenario — a deployed task definition accidentally shipping
 * `NODE_ENV=test` (e.g. a copy-pasted CI config), run via `node dist/main.js` — sailed
 * straight through it: `isProduction` reads `false`, the guard stayed quiet, and the app ran
 * in production with 500x looser rate limits.
 *
 * The fix: stop deriving danger from `isProduction` (defined by the same variable as the
 * multiplier) and detect "the 500x multiplier is active" independently of what `NODE_ENV`
 * happens to also say. The actual invariant this guard needs is "the 500x multiplier must
 * only ever be active when running under the Vitest test runner" — checked via
 * `process.env.VITEST`, which Vitest itself sets on every worker process before any module
 * loads (unlike `NODE_ENV=test`, which a misconfigured deploy could set by accident, `VITEST`
 * is never something a real deployed task would ever have set). This now correctly fires for
 * the real danger case (task def sets `NODE_ENV=test`, runs via `node dist/main.js`, no
 * `VITEST` env var present) — no longer only for a case that could never happen. Deliberately
 * NOT a full env-schema-driven config value (a bigger change, out of scope for this hardening
 * pass) — just a guard against the one dangerous silent case, now one that's actually
 * reachable.
 */
export function assertRateLimitMultiplierIsSafeForProduction(): void {
  if (DECORATOR_TIME_MULTIPLIER !== 1 && process.env["VITEST"] === undefined) {
    const multiplier = String(DECORATOR_TIME_MULTIPLIER);
    throw new Error(
      `Configuração de rate limit inválida: o multiplicador de teste ` +
        `(DECORATOR_TIME_MULTIPLIER=${multiplier}) está ativo fora do Vitest — os limites de ` +
        `strictIp/moderateIp ficariam ${multiplier}x mais permissivos do que o ` +
        `pretendido. Verifique a variável de ambiente NODE_ENV desta task (nunca "test" fora ` +
        `de testes).`,
    );
  }
}
