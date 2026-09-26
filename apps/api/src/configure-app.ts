import type { INestApplication } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";

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
