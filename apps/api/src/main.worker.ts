import "reflect-metadata";

import { loadRootEnvFile } from "./config/load-root-env-file";

// Must run before `./app.module` is required below — see the comment in main.ts for why
// (AppConfigModule's ConfigModule.forRoot validates process.env synchronously at
// require()-time, not later inside NestFactory.createApplicationContext).
loadRootEnvFile();

import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { DomainEventsProcessor, OutboxRelayProcessor } from "./modules/shared";

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

  // Same reasoning as `outboxRelay.start()` above (ADR-0017 §4): `DomainEventsProcessor`'s
  // BullMQ `Worker` is constructed with `autorun: false` in BOTH entrypoints (`AppModule` is
  // shared), so it never pulls a job from Redis on its own — only this explicit `.run()`,
  // called exclusively here, starts it consuming the `domain-events` queue.
  //
  // Deliberately NOT awaited (code review fix — awaiting this blocked `bootstrap()` forever
  // and skipped registering the SIGTERM/SIGINT handlers below entirely): BullMQ's
  // `Worker.run()` doesn't resolve until the worker is closed — it's the same
  // "fire-and-forget, `.catch()` for the unhandled-rejection case" shape as
  // `outboxRelay.start()`'s own `setInterval`, not something to `await`.
  const domainEventsProcessor = app.get(DomainEventsProcessor);
  domainEventsProcessor.worker.run().catch((error: unknown) => {
    logger.error(error, "Erro no despachante de eventos de domínio", "Worker");
  });
  logger.log("Worker iniciado — despachante de eventos de domínio em execução (ADR-0017).", "Worker");

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
    domainEventsProcessor.worker
      .close()
      .catch((error: unknown) => {
        logger.error(error, "Erro ao encerrar o despachante de eventos de domínio", "Worker");
      })
      .finally(() => {
        app
          .close()
          .catch((error: unknown) => {
            logger.error(error, "Erro ao encerrar o worker", "Worker");
          })
          .finally(() => {
            process.exit(0);
          });
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
