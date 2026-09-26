import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { Options as PinoHttpOptions } from "pino-http";

import { AppConfigModule } from "../config/app-config.module";
import { AppConfigService } from "../config/app-config.service";
import { type SerializableRequest, serializeRequestWithRedactedTokens } from "./redact-opaque-tokens";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Structured JSON logging (ULTRAPLAN 0.3, system-design.md §9): `nestjs-pino`, with
 * `requestId` propagated (reused from an incoming `X-Request-Id` header when present,
 * otherwise generated, and always echoed back on the response) and basic redaction of
 * sensitive headers/fields configured up front — even though no personal data (plate,
 * CPF, e-mail, token — CLAUDE.md rule 10) flows through this layer yet.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => {
        const pinoHttp: PinoHttpOptions = {
          level: appConfig.logLevel,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers[REQUEST_ID_HEADER];
            const requestId =
              typeof existing === "string" && existing.length > 0 ? existing : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, requestId);
            return requestId;
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-api-key"]',
              "req.body.password",
              "req.body.token",
              "req.body.accessToken",
              "req.body.refreshToken",
              'res.headers["set-cookie"]',
            ],
            censor: "[REDACTED]",
          },
          // Security-review fix (ULTRAPLAN 1.5): without this, the live invitation accept
          // token (`GET /v1/invitations/:token`, `POST /v1/invitations/:token/accept`) was
          // logged in the clear on every request — see `redact-opaque-tokens.ts`'s own doc
          // comment for why a path-based `redact.paths` entry can't fix this here.
          serializers: {
            req: (req: SerializableRequest) => serializeRequestWithRedactedTokens(req),
          },
          // `exactOptionalPropertyTypes`: only set `transport` at all outside production
          // (pino-pretty is a dev-only dependency of readability, not a real transport
          // for shipped JSON logs) — assigning `undefined` explicitly isn't allowed.
          ...(appConfig.isProduction
            ? {}
            : {
                transport: {
                  target: "pino-pretty",
                  options: { singleLine: true, translateTime: "HH:MM:ss.l" },
                },
              }),
        };

        return { pinoHttp };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
