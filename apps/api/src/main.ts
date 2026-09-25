import "reflect-metadata";

import { loadRootEnvFile } from "./config/load-root-env-file";

// Must run before `./app.module` is required below — NOT just before
// `NestFactory.create()`. `AppConfigModule`'s `@Module({ imports:
// [ConfigModule.forRoot({ validate: validateEnv })] })` decorator calls
// `ConfigModule.forRoot()` synchronously at class-declaration time (i.e. the moment
// `require("./app.module")` pulls it in), and `forRoot()` calls `validate(process.env)`
// before its first `await` — so `process.env` must already be populated by then.
// (Caught by manually smoke-testing the built `dist/main.js`; the integration tests
// don't exercise this ordering bug because Vitest's `setupFiles` already loads the
// root `.env` before any test file — and therefore `app.module.ts` — is imported.)
loadRootEnvFile();

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { cleanupOpenApiDoc } from "nestjs-zod";

import { AppModule } from "./app.module";
import { AppConfigService } from "./config/app-config.service";

/**
 * HTTP entrypoint (ULTRAPLAN 0.3). Same source/AppModule as the worker
 * (main.worker.ts) — see docs/adr/0001-modular-monolith-nestjs.md.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Drains in-flight requests on SIGTERM before the process exits — matters on ECS
  // Fargate (system-design.md §5/§11), where the ALB stops routing but existing
  // connections need a moment to finish during deploys/scale-in.
  app.enableShutdownHooks();

  const appConfig = app.get(AppConfigService);
  app.enableCors({ origin: appConfig.corsOrigins });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Neulander Parking API")
    .setDescription(
      "API do painel operador/gestor e ingestão do agente de borda LPR (REST /v1, WebSocket). " +
        "Ainda sem endpoints de domínio (ULTRAPLAN Fase 0) — só o esqueleto de bootstrap.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Post-processes the OpenAPI doc so `nestjs-zod` DTOs (Zod v4's native JSON Schema
  // output) render cleanly — see docs/architecture/api-and-events.md line 3.
  SwaggerModule.setup("docs", app, cleanupOpenApiDoc(document));

  await app.listen(appConfig.http.port, appConfig.http.host);
}

bootstrap().catch((error: unknown) => {
  // Logger isn't wired yet if bootstrap fails this early — plain console is the fallback.
  console.error("Falha ao iniciar a API:", error);
  process.exit(1);
});
