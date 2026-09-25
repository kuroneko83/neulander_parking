import "reflect-metadata";

import { loadRootEnvFile } from "./config/load-root-env-file";

// Must run before `./app.module` is required below — see the comment in main.ts for why
// (AppConfigModule's ConfigModule.forRoot validates process.env synchronously at
// require()-time, not later inside NestFactory.createApplicationContext).
loadRootEnvFile();

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { OutboxRelayProcessor } from "./modules/shared";

/**
 * Worker entrypoint (ULTRAPLAN 0.3, outbox relay wired in 0.5). Same source/AppModule as
 * the HTTP API (main.ts) — see docs/adr/0001-modular-monolith-nestjs.md ("API e worker
 * são o mesmo código, dois entrypoints").
 *
 * `OutboxRelayProcessor.start()` is called here, and ONLY here (ULTRAPLAN 0.5 decision):
 * `AppModule`/`SharedModule` are shared by both entrypoints, so the processor never starts
 * its own polling from a Nest lifecycle hook (`OnModuleInit`) — that would run it in the
 * HTTP process too. The HTTP API (main.ts) only ever writes to the outbox via
 * `OutboxService`; publishing pending rows to BullMQ happens exclusively here.
 *
 * Domain modules register their own BullMQ processors as they're built (Phase 1+) — this
 * file should stay limited to bootstrapping + the one relay it owns, not grow into a
 * catch-all for every future worker concern.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const logger = app.get(Logger);

  const outboxRelay = app.get(OutboxRelayProcessor);
  outboxRelay.start();
  logger.log("Worker iniciado — outbox relay em execução (ULTRAPLAN 0.5).", "Worker");

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    // Guard against a second SIGTERM/SIGINT arriving mid-shutdown (e.g. an
    // orchestrator sending TERM twice) — without this, `app.close()` (and the pg
    // pool's `.end()` inside it) would run twice and throw "Called end on pool more
    // than once" instead of shutting down cleanly.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.log(`Recebido ${signal}, encerrando worker...`, "Worker");
    outboxRelay.stop();
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
