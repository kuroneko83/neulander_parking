import { createHash } from "node:crypto";

import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { BadRequestException, ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { and, eq } from "drizzle-orm";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { from, of, switchMap, tap } from "rxjs";

import type { Database } from "../../../database/database.module";
import { DATABASE_CONNECTION } from "../../../database/database.module";
import type { Clock } from "../domain/clock";
import { idempotencyKeys } from "./schema";
import { CLOCK } from "./system-clock";

/** TTL for a stored idempotency record (data-model.md "Particionamento e retenção":
 * `idempotency_keys`: TTL 24h, purged by the daily `housekeeping` job — this constant is
 * just what feeds `expires_at`; actual deletion is that job's responsibility, not this
 * interceptor's). */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request shape after a future auth guard runs (Phase 1/5) — see `resolveScope` below. */
interface RequestWithIdempotencyScope extends Request {
  idempotencyScope?: string;
}

/**
 * Generic `Idempotency-Key` mechanism (ULTRAPLAN 0.5, docs/architecture/api-and-events.md
 * line 10: "resposta reproduzida se a chave repetir com o mesmo corpo; 409 se corpo
 * diferente"). Applied per-route with `@UseInterceptors(IdempotencyInterceptor)` — NOT
 * global — since only the specific endpoints CLAUDE.md rule 6 calls out (entrada/saída,
 * pagamento, webhooks) require it.
 *
 * Flow:
 * 1. Reads the `Idempotency-Key` header — missing/malformed (not a UUID) → 400.
 * 2. Hashes the request body (sha256 of its JSON serialization).
 * 3. Looks up `idempotency_keys` by `(scope, key)`:
 *    - found + same hash → replays the stored `(responseStatus, responseBody)` without
 *      invoking the route handler at all.
 *    - found + different hash → 409 Conflict (same key reused for a different request).
 *    - not found → runs the handler, then stores its outcome for next time.
 *
 * **`scope` placeholder (auth doesn't exist yet — Fase 1/5):** there's no authenticated
 * actor to key on, so `scope` falls back to `request.idempotencyScope` (a hook future
 * guards can populate once they exist) or, failing that, the caller's IP address. This is
 * a deliberately provisional choice — replace it with the real actor identity (user id
 * for operator-facing endpoints, device id for the LPR device API) as soon as auth lands;
 * do not build an auth system here to "solve" it properly ahead of schedule.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithIdempotencyScope>();
    const key = request.header("Idempotency-Key");

    if (!key) {
      throw new BadRequestException("Header Idempotency-Key é obrigatório para este endpoint.");
    }
    if (!UUID_REGEX.test(key)) {
      throw new BadRequestException("Idempotency-Key precisa ser um UUID.");
    }

    const scope = resolveScope(request);
    const requestHash = hashBody(request.body as unknown);

    return from(this.findExisting(scope, key)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictException(
              "Idempotency-Key já foi usada com um corpo de requisição diferente.",
            );
          }
          return of(existing.responseBody);
        }

        return next.handle().pipe(
          tap((body: unknown) => {
            const status = statusOf(context);
            // Fire-and-forget from the interceptor's point of view — the response has
            // already been decided and must not wait on this write. Failure here just
            // means a retry of the same request won't be able to replay (it'll re-run
            // the handler), not that anything about this response was wrong; logged
            // instead of silently swallowed for that reason.
            this.store(scope, key, requestHash, status, body).catch((error: unknown) => {
              this.logger.error(error, "Falha ao gravar resposta idempotente");
            });
          }),
        );
      }),
    );
  }

  private async findExisting(
    scope: string,
    key: string,
  ): Promise<{ requestHash: string; responseBody: unknown } | undefined> {
    const [existing] = await this.db
      .select({
        requestHash: idempotencyKeys.requestHash,
        responseBody: idempotencyKeys.responseBody,
      })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);

    return existing;
  }

  private async store(
    scope: string,
    key: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.db
      .insert(idempotencyKeys)
      .values({
        scope,
        key,
        requestHash,
        responseStatus,
        responseBody,
        expiresAt: new Date(this.clock.now().getTime() + IDEMPOTENCY_TTL_MS),
      })
      // Two concurrent requests with the exact same (scope, key) racing past
      // `findExisting()` both returning nothing is possible (no locking here, by
      // design — the earlier request "wins", and the loser's response is served to its
      // own caller but not persisted). Accepted simplification: the mechanism is meant
      // to protect against a client's *retry* of the same request, not to serialize
      // genuinely concurrent first attempts.
      .onConflictDoNothing();
  }
}

/**
 * `scope` disambiguates *which* client namespace a given `Idempotency-Key` belongs to —
 * see the class doc comment above for why this is a placeholder pre-auth.
 */
function resolveScope(request: RequestWithIdempotencyScope): string {
  if (request.idempotencyScope) {
    return request.idempotencyScope;
  }
  return `ip:${request.ip ?? "unknown"}`;
}

/** Note: `JSON.stringify` preserves each object's own key insertion order, so two
 * requests with the exact same fields serialized in a different order would hash
 * differently (a false "different body" 409). Every client here is either our own web
 * panel/mobile app or a Zod-validated request DTO built the same way each time, so this
 * is an accepted simplification, not a canonical-JSON implementation. */
function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * The HTTP status this response will end up with. Reading `response.statusCode` here
 * would be unreliable — Nest's router only applies the `@HttpCode()`/default status to
 * the underlying response object when it actually sends it, which happens *after* every
 * interceptor's `tap()` already ran. Nest's own default (200, or 201 for POST, unless
 * `@HttpCode()` overrides it) is recomputed independently — and identically — on replay,
 * so this only needs to match what gets stored, not force what gets sent.
 */
function statusOf(context: ExecutionContext): number {
  const reflectedStatus = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
    | number
    | undefined;
  if (reflectedStatus !== undefined) {
    return reflectedStatus;
  }
  const request = context.switchToHttp().getRequest<Request>();
  return request.method === "POST" ? 201 : 200;
}
