import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { pino } from "pino";
import pinoHttp from "pino-http";
import { describe, expect, it } from "vitest";

import {
  redactOpaqueTokens,
  type SerializableRequest,
  serializeRequestWithRedactedTokens,
} from "./redact-opaque-tokens";

/** A real, well-formed opaque token — generated exactly the way
 * `generateOpaqueToken()` (`modules/identity/domain/opaque-token.ts`) does (`randomBytes(32)
 * .toString("hex")`, i.e. always exactly 64 lowercase hex characters), not a hand-typed
 * placeholder — a transcription slip in a literal (wrong length, stray character) would
 * silently make every assertion below pass for the wrong reason. */
const SAMPLE_TOKEN = randomBytes(32).toString("hex");

describe("redactOpaqueTokens", () => {
  it("replaces a 64-hex-char token embedded in a string with [REDACTED]", () => {
    expect(redactOpaqueTokens(`/v1/invitations/${SAMPLE_TOKEN}`)).toBe(
      "/v1/invitations/[REDACTED]",
    );
  });

  it("replaces a token nested inside an object's string values, at any key", () => {
    // Mirrors the actual shape observed in this app's own request logs (see
    // `redact-opaque-tokens.ts`'s doc comment): pino-http serializes `req.params` BEFORE
    // Nest's router resolves named params, so the token ends up under an arbitrary numeric
    // key, not `params.token`.
    const input = { "0": `invitations/${SAMPLE_TOKEN}/accept` };
    expect(redactOpaqueTokens(input)).toEqual({ "0": "invitations/[REDACTED]/accept" });
  });

  it("replaces a token nested inside an array", () => {
    expect(redactOpaqueTokens([`a/${SAMPLE_TOKEN}`, "b"])).toEqual(["a/[REDACTED]", "b"]);
  });

  it("leaves strings with no token-shaped substring untouched", () => {
    expect(redactOpaqueTokens("/v1/auth/login")).toBe("/v1/auth/login");
  });

  it("does not redact a hex string shorter than 64 characters (e.g. a UUID)", () => {
    const uuid = "01933b6a-1a00-7000-8000-000000000001";
    expect(redactOpaqueTokens(`/v1/orgs/${uuid}/members`)).toBe(`/v1/orgs/${uuid}/members`);
  });

  it("passes through non-string/object/array values unchanged", () => {
    expect(redactOpaqueTokens(42)).toBe(42);
    expect(redactOpaqueTokens(null)).toBe(null);
    expect(redactOpaqueTokens<unknown>(undefined)).toBeUndefined();
  });
});

describe("serializeRequestWithRedactedTokens", () => {
  function fakeRequest(overrides: Partial<SerializableRequest> = {}): SerializableRequest {
    return {
      id: "req-1",
      method: "GET",
      url: `/v1/invitations/${SAMPLE_TOKEN}`,
      query: {},
      // The real pino-std-serializers `reqSerializer` output shape this function actually
      // receives (see `SerializableRequest`'s own doc comment) — flat `remoteAddress`/
      // `remotePort`, no `.socket` wrapper, and `params` already collapsed to whatever
      // pino-http itself captured before Nest's router ran.
      params: { "0": `invitations/${SAMPLE_TOKEN}` },
      headers: { authorization: `Bearer ${SAMPLE_TOKEN}` },
      remoteAddress: "127.0.0.1",
      remotePort: 12345,
      ...overrides,
    };
  }

  it("redacts the token from both url and params", () => {
    // `headers` is deliberately excluded from this assertion — see the next test: this
    // serializer alone never touches headers, only `url`/`query`/`params`.
    const serialized = serializeRequestWithRedactedTokens(fakeRequest());

    expect(serialized["url"]).toBe("/v1/invitations/[REDACTED]");
    expect(serialized["params"]).toEqual({ "0": "invitations/[REDACTED]" });
    expect(JSON.stringify({ url: serialized["url"], params: serialized["params"] })).not.toContain(
      SAMPLE_TOKEN,
    );
  });

  it("does NOT redact headers itself — that remains pino's redact.paths job", () => {
    // `logging.module.ts`'s real config also sets `redact.paths` with
    // `req.headers.authorization` — this serializer alone is deliberately not responsible
    // for header redaction, only url/params/query (content-based, not path-based).
    const serialized = serializeRequestWithRedactedTokens(fakeRequest());

    expect(serialized["headers"]).toEqual({ authorization: `Bearer ${SAMPLE_TOKEN}` });
  });

  it("passes remoteAddress/remotePort through untouched (post-review fix: previously read from a non-existent req.socket)", () => {
    const serialized = serializeRequestWithRedactedTokens(
      fakeRequest({ remoteAddress: "203.0.113.7", remotePort: 54321 }),
    );

    expect(serialized["remoteAddress"]).toBe("203.0.113.7");
    expect(serialized["remotePort"]).toBe(54321);
  });

  it("does not crash and reports undefined remoteAddress/remotePort when the input has neither", () => {
    const { remoteAddress: _r, remotePort: _p, ...withoutConnectionInfo } = fakeRequest();
    const serialized = serializeRequestWithRedactedTokens(withoutConnectionInfo);

    expect(serialized["remoteAddress"]).toBeUndefined();
    expect(serialized["remotePort"]).toBeUndefined();
  });
});

/** Collects every line pino writes as a parsed JSON object — same shape a real log sink
 * (stdout, CloudWatch, ...) would receive. */
function collectingStream(lines: Record<string, unknown>[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim().length > 0) {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
      callback();
    },
  });
}

describe("real pino instance wired with this app's logging.module.ts config (end-to-end verification)", () => {
  it("a request-completed log line for GET /v1/invitations/:token never contains the raw token", () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      {
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie"],
          censor: "[REDACTED]",
        },
        serializers: {
          req: (req: SerializableRequest) => serializeRequestWithRedactedTokens(req),
        },
      },
      collectingStream(lines),
    );

    logger.info(
      {
        req: {
          id: "req-1",
          method: "GET",
          url: `/v1/invitations/${SAMPLE_TOKEN}`,
          query: {},
          params: { "0": `invitations/${SAMPLE_TOKEN}` },
          headers: { authorization: `Bearer ${SAMPLE_TOKEN}`, host: "localhost:3333" },
          remoteAddress: "127.0.0.1",
          remotePort: 12345,
        },
        res: { statusCode: 200 },
      },
      "request completed",
    );

    expect(lines).toHaveLength(1);
    const rawLine = JSON.stringify(lines[0]);
    expect(rawLine).not.toContain(SAMPLE_TOKEN);

    const [line] = lines;
    const req = line?.["req"] as Record<string, unknown>;
    expect(req["url"]).toBe("/v1/invitations/[REDACTED]");
    expect(req["params"]).toEqual({ "0": "invitations/[REDACTED]" });
    expect((req["headers"] as Record<string, unknown>)["authorization"]).toBe("[REDACTED]");
  });

  it("a request-completed log line for the accept endpoint (POST .../accept) also never contains the raw token", () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      {
        redact: { paths: ["req.headers.authorization"], censor: "[REDACTED]" },
        serializers: {
          req: (req: SerializableRequest) => serializeRequestWithRedactedTokens(req),
        },
      },
      collectingStream(lines),
    );

    logger.info(
      {
        req: {
          id: "req-2",
          method: "POST",
          url: `/v1/invitations/${SAMPLE_TOKEN}/accept`,
          query: {},
          params: { "0": `invitations/${SAMPLE_TOKEN}/accept` },
          headers: { host: "localhost:3333" },
        },
      },
      "request completed",
    );

    const rawLine = JSON.stringify(lines[0]);
    expect(rawLine).not.toContain(SAMPLE_TOKEN);
  });
});

describe("real pino-http middleware pipeline (not a hand-built fixture) — end-to-end verification, post-review", () => {
  /**
   * The previous version of this fix was verified only against a hand-built object that
   * (incorrectly) included a `.socket` field, which is why the original
   * `req.socket?.remoteAddress` bug slipped through review once already. This test instead
   * drives the REAL `pino-http` package (the same one `@nestjs/pino`/`logging.module.ts`
   * wires up) with a raw request-like object shaped like a genuine Node `http.IncomingMessage`
   * (`.socket.remoteAddress`/`.socket.remotePort`, NOT flat) — `pino-http` internally wraps
   * our custom `serializers.req` via `pino-std-serializers`' `wrapRequestSerializer`, which
   * runs the RAW request through its own default `reqSerializer` FIRST (flattening
   * `socket.remoteAddress` → top-level `remoteAddress`) before ever calling our function — so
   * this is the only way to actually prove `serializeRequestWithRedactedTokens` receives (and
   * correctly reads) the shape it claims to.
   */
  it("a real pino-http request-completed log line has remoteAddress/remotePort populated, headers redacted, and the token stripped from url/params", () => {
    const lines: Record<string, unknown>[] = [];
    const httpLogger = pinoHttp(
      {
        redact: { paths: ["req.headers.authorization"], censor: "[REDACTED]" },
        serializers: {
          req: (req: SerializableRequest) => serializeRequestWithRedactedTokens(req),
        },
      },
      collectingStream(lines),
    );

    // A raw request-like object shaped like Node's real `http.IncomingMessage`: connection
    // info lives under `.socket`, NOT as flat `remoteAddress`/`remotePort` fields — pino-http's
    // own default serializer is what flattens it, before our custom serializer ever runs.
    const rawRequest = {
      method: "GET",
      url: `/v1/invitations/${SAMPLE_TOKEN}`,
      headers: { authorization: `Bearer ${SAMPLE_TOKEN}`, host: "localhost:3333" },
      socket: { remoteAddress: "203.0.113.42", remotePort: 54321 },
    };
    const rawResponse = Object.assign(new EventEmitter(), { statusCode: 200 });

    httpLogger(
      rawRequest as unknown as Parameters<typeof httpLogger>[0],
      rawResponse as unknown as Parameters<typeof httpLogger>[1],
      () => undefined,
    );
    // pino-http logs on response completion — triggered by 'finish'/'close'/'error'.
    rawResponse.emit("finish");

    expect(lines).toHaveLength(1);
    const [line] = lines;
    const req = line?.["req"] as Record<string, unknown>;

    expect(req["remoteAddress"]).toBe("203.0.113.42");
    expect(req["remotePort"]).toBe(54321);
    expect(req["url"]).toBe("/v1/invitations/[REDACTED]");
    expect((req["headers"] as Record<string, unknown>)["authorization"]).toBe("[REDACTED]");
    expect(JSON.stringify(line)).not.toContain(SAMPLE_TOKEN);
  });
});
