import "reflect-metadata";

import { loadRootEnvFile } from "./config/load-root-env-file";

// Must run before `./app.module` is required below — see the comment in main.ts for why
// (AppConfigModule's ConfigModule.forRoot validates process.env synchronously at
// require()-time, not later inside NestFactory.createApplicationContext).
loadRootEnvFile();

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";

/**
 * Worker entrypoint (ULTRAPLAN 0.3). Same source/AppModule as the HTTP API
 * (main.ts) — see docs/adr/0001-modular-monolith-nestjs.md ("API e worker são o mesmo
 * código, dois entrypoints").
 *
 * There's no queue infra yet — `outbox_events` + the BullMQ relay land in ULTRAPLAN 0.5,
 * and domain modules register their own BullMQ processors as they're built (Phase 1+).
 * This entrypoint only proves the same codebase boots as an application context
 * (no HTTP listener) — nothing here should invent queue processing that doesn't exist.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const logger = app.get(Logger);
  logger.log("Worker iniciado — nenhum processor registrado ainda (ULTRAPLAN 0.5+).", "Worker");

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.log(`Recebido ${signal}, encerrando worker...`, "Worker");
    app
      .close()
      .catch((error: unknown) => {
        logger.error(error, "Erro ao encerrar o worker", "Worker");
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

bootstrap().catch((error: unknown) => {
  // Logger isn't wired yet if bootstrap fails this early — plain console is the fallback.
  console.error("Falha ao iniciar o worker:", error);
  process.exit(1);
});
