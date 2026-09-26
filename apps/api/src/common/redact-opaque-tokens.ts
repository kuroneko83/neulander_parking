import type { IncomingMessage } from "node:http";

/**
 * Pure logging-redaction helpers — deliberately kept in their OWN file, with no Nest/
 * `AppConfigModule` import (unlike `logging.module.ts`, which already imports
 * `AppConfigModule` and therefore eagerly validates `process.env` the moment it's imported,
 * same as `problem-details.exception-filter.ts`'s own doc comment documents for
 * `DomainError`). `redact-opaque-tokens.test.ts`/`logging.module.ts` both import from here.
 *
 * Matches the plaintext opaque tokens this codebase puts in a URL PATH segment (never in a
 * header/body pino's `redact.paths` already covers) — `generateOpaqueToken()`
 * (`modules/identity/domain/opaque-token.ts`): 32 random bytes, hex-encoded, always exactly
 * 64 lowercase hex characters. Both `GET /v1/invitations/:token` and `POST
 * /v1/invitations/:token/accept` carry the invitation's live accept token this way
 * (security-review fix, ULTRAPLAN 1.5) — content-matched rather than path-matched
 * (`req.url`/`req.params.token`) because of a second bug this fix also has to route
 * around: `nestjs-pino`'s request logging middleware sits in front of Nest's own router, so
 * by the time pino-http serializes `req`, Express hasn't resolved named route params yet —
 * `req.params` at that point is `{ "0": "invitations/<token>..." }` (the raw remainder past
 * whatever wildcard mount pino-http's middleware itself matched), NOT `{ token: "<token>" }`.
 * A path-based `redact.paths: ["req.params.token"]` entry would therefore silently redact
 * nothing. Matching the token's own fixed, distinctive shape wherever it appears (`url`,
 * `originalUrl`, and recursively through `params`/`query`) closes that gap regardless of
 * which key it ends up under.
 */
const OPAQUE_TOKEN_PATTERN = /[a-f0-9]{64}/g;
const REDACTED = "[REDACTED]";

/** Does the actual recursion, entirely in terms of `unknown` — kept separate from the
 * generic, typed `redactOpaqueTokens<T>` wrapper below specifically so the recursive calls
 * themselves never touch a generic type parameter (`T` can't be narrowed by
 * `Array.isArray`/`typeof value === "object"`, which is what produced an unsafe-`any`
 * return when this was written as a single generic function). */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(OPAQUE_TOKEN_PATTERN, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    );
  }
  return value;
}

/** Recursively replaces any opaque-token-shaped substring with `"[REDACTED]"` — applied to
 * `url`/`originalUrl`/`query`/`params` in `serializeRequestWithRedactedTokens` below. Leaves
 * every other character/field untouched (unlike pino's path-based `redact`, which censors an
 * entire field's value), so a log line stays useful for debugging routing issues while
 * never containing the live secret itself.
 *
 * Typed as `<T>(value: T): T` at this single boundary (one cast, not one per recursive
 * call) — the actual shape never changes, only string leaves get rewritten, so the input
 * and output types are genuinely the same. */
export function redactOpaqueTokens<T>(value: T): T {
  return redactValue(value) as T;
}

/**
 * Request shape our custom `serializers.req` actually receives (log-hygiene fix,
 * post-review): `@nestjs/pino`/`pino-http` wraps any custom `serializers.req` via
 * `pino-std-serializers`' `wrapRequestSerializer` — `wrappedReqSerializer(req) =>
 * customSerializer(reqSerializer(req))` — meaning pino-http ALREADY runs the raw incoming
 * request through its own default `reqSerializer` first, and THIS function only ever sees
 * that default serializer's flat OUTPUT (`{ id, method, url, query, params, headers,
 * remoteAddress, remotePort, raw }`, per `pino-std-serializers/lib/req.js`), never the raw
 * `http.IncomingMessage` itself. `remoteAddress`/`remotePort` are therefore already
 * top-level fields here — NOT nested under a `.socket` (a previous version of this file
 * read `req.socket?.remoteAddress`, which silently produced `undefined` for every request
 * app-wide, since the object handed in has no `socket` property at all; caught in review,
 * confirmed by reading `pino-std-serializers`' own source rather than assuming).
 */
export interface SerializableRequest {
  id?: unknown;
  method?: string;
  url?: string;
  query?: unknown;
  params?: unknown;
  headers: IncomingMessage["headers"];
  remoteAddress?: string;
  remotePort?: number;
}

export function serializeRequestWithRedactedTokens(
  req: SerializableRequest,
): Record<string, unknown> {
  return {
    id: req.id,
    method: req.method,
    url: redactOpaqueTokens(req.url ?? ""),
    query: redactOpaqueTokens(req.query ?? {}),
    params: redactOpaqueTokens(req.params ?? {}),
    headers: req.headers,
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  };
}
