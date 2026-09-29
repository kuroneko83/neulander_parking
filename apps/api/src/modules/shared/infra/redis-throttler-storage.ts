import type { OnApplicationShutdown } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import { Redis } from "ioredis";

import { AppConfigService } from "../../../config/app-config.service";
import { SampledWarnLogger } from "./sampled-warn-logger";

/**
 * `@nestjs/throttler` declares this shape in `throttler-storage-record.interface.ts` but
 * does NOT re-export it from the package's public entrypoint (only `ThrottlerStorage`
 * itself is, via `index.ts`'s `export * from './throttler-storage.interface'`) — derived
 * here from the one signature that IS public, instead of hand-duplicating the four fields
 * and risking silent drift from the real interface.
 */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

/** Fail-open fallback record (ULTRAPLAN 1.6 security-review fix, blocking #3): never
 * blocks, zero hits. Returned by every method below when Redis itself is the thing that
 * failed (timeout/unreachable/etc) — see the class doc comment for the fail-open vs
 * fail-closed rationale. */
const OPEN_RECORD: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/** ULTRAPLAN 1.6 security-review fix (nit): a short env prefix so this adapter's keys never
 * collide with another environment sharing the same physical Redis — concretely, local dev
 * (`pnpm dev`) and `pnpm test:int` both point at the SAME `infra/docker/compose.yml` Redis
 * instance today (see that file's own comment: "cache, filas BullMQ... nunca fonte de
 * verdade" — no per-environment instance locally, unlike RDS/ElastiCache in AWS where each
 * environment already gets its own). */
function keyPrefix(appConfig: AppConfigService): string {
  return `rl:${appConfig.nodeEnv}:`;
}

/**
 * Builds the pair of Redis keys a single `(throttlerName, key)` pair maps to, with a
 * REDIS CLUSTER HASH TAG (ULTRAPLAN 1.6 security-review fix, nit): `{...}` around the part
 * that must hash to the same slot. `INCREMENT_SCRIPT` touches two keys in ONE Lua script
 * invocation — on a real Redis Cluster (this instance is single-node today,
 * ElastiCache non-cluster-mode, but system-design.md doesn't rule out cluster mode later),
 * `EVAL`/`EVALSHA` requires every key a script touches to live on the SAME slot, which Redis
 * derives purely from whatever substring sits inside the first `{}` in the key — here,
 * `{<throttlerName>:<opaqueKey>}` — so the "hit:"/"block:" prefix OUTSIDE the braces never
 * affects slot placement, but is enough to keep the two keys visually distinguishable in
 * `redis-cli KEYS`/`SCAN` output. Cheap to add now; expensive to retrofit once real traffic
 * already has state under the old, tag-less key shape.
 */
function buildKeys(
  appConfig: AppConfigService,
  key: string,
  throttlerName: string,
): { hitKey: string; blockKey: string } {
  const prefix = keyPrefix(appConfig);
  const tag = `${throttlerName}:${key}`;
  return {
    hitKey: `${prefix}throttle:hit:{${tag}}`,
    blockKey: `${prefix}throttle:block:{${tag}}`,
  };
}

/**
 * Atomic fixed-window counter + separate "blocked" flag, run as a single Lua script so
 * concurrent requests across every ECS Fargate task hitting the same Redis never race
 * each other (system-design.md §5/§11 — multiple API instances behind the ALB is exactly
 * why `@nestjs/throttler`'s DEFAULT in-memory `ThrottlerStorageService` is unusable here:
 * each task would track its own counter, multiplying the effective limit by instance
 * count).
 *
 * Mirrors the semantics of `@nestjs/throttler`'s own in-memory implementation
 * (`ThrottlerStorageService.increment`, see `node_modules/@nestjs/throttler/dist/throttler.service.js`):
 * a request inside the window increments a hit counter; once hits exceed `limit`, a
 * SEPARATE "blocked" flag is set for `blockDuration` — every request while blocked is
 * rejected immediately and does NOT keep incrementing the hit counter (so a sustained
 * attack doesn't grow a Redis key unboundedly).
 *
 * KEYS[1] = hit-counter key   KEYS[2] = block-flag key
 * ARGV[1] = ttl in ms (counter window)   ARGV[2] = limit   ARGV[3] = blockDuration in ms
 *
 * Returns `{ totalHits, timeToExpireMs, isBlocked (0|1), timeToBlockExpireMs }` — all
 * still in MILLISECONDS; `RedisThrottlerStorage.increment()` converts to seconds (what
 * `ThrottlerStorageRecord` actually expects, matching the in-memory implementation) after
 * this script returns.
 */
const INCREMENT_SCRIPT = `
local blockPttl = redis.call("PTTL", KEYS[2])
if blockPttl and blockPttl > 0 then
  local hits = tonumber(redis.call("GET", KEYS[1]) or "0")
  return { hits, 0, 1, blockPttl }
end

local hits = redis.call("INCR", KEYS[1])
if hits == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local hitPttl = redis.call("PTTL", KEYS[1])
if hitPttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  hitPttl = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  redis.call("SET", KEYS[2], "1", "PX", ARGV[3])
  return { hits, hitPttl, 1, tonumber(ARGV[3]) }
end

return { hits, hitPttl, 0, 0 }
`;

/**
 * Round-4 security-review fix (LOW): a read-only counterpart of `INCREMENT_SCRIPT`
 * (`PEEK_SCRIPT`) and the `RedisThrottlerStorage.peek()` method that used it were removed —
 * both had become dead in production.
 *
 * ULTRAPLAN 1.6 security-review history: originally added for the identifier-failure-only
 * limiter (`identifier-failure-throttle.interceptor.ts`), which called `peek()` BEFORE
 * running the route handler to check "is this identifier currently blocked?" without that
 * check itself counting as a hit. That design turned out to be a TOCTOU race under
 * concurrency (round-2 security-review finding, blocking #1): a read-only pre-check can't
 * serialize concurrent requests the way an atomic `INCREMENT_SCRIPT` call does, so N parallel
 * requests sharing one identifier could all `peek()` at "0 hits" and all pass. That
 * interceptor was fixed to call `increment()` directly instead (see its own doc comment) and
 * stopped calling `peek()` at all — leaving it with no caller anywhere outside its own tests.
 *
 * Deleted rather than kept "just in case": a write-free "check without counting" primitive
 * sitting unused in a security-sensitive rate-limit adapter is exactly the shape a future
 * contributor would reach for and unknowingly reintroduce the very TOCTOU bug above — safer
 * to remove it than leave it as an attractive nuisance. If a genuine read-only "is this
 * currently blocked" need ever comes up again, re-add it deliberately, re-reading this
 * comment first.
 */
type ScriptReply = [totalHits: number, timeToExpireMs: number, isBlocked: number, timeToBlockExpireMs: number];

/** The method `this.redis.defineCommand(...)` attaches onto every client instance at
 * runtime. Deliberately NOT a `declare module "ioredis"` ambient augmentation of
 * `RedisCommander` — ioredis' real interface is
 * `RedisCommander<Context extends ClientContext = {...}>` (a constrained, defaulted type
 * parameter); re-declaring it here with a different/looser parameter list to attach an
 * extra method broke the ENTIRE interface's type resolution for every other caller in this
 * codebase (`RedisHealthIndicator`'s unrelated `client.ping()` started type-checking as
 * `any`) — a single explicit cast at each call site below is far safer. */
type ThrottleScriptCommand = (hitKey: string, blockKey: string, ttlMs: number, limit: number, blockDurationMs: number) => Promise<ScriptReply>;

/** `ThrottlerStorageRecord`'s two duration fields are in SECONDS (matches
 * `@nestjs/throttler`'s own in-memory implementation, whose `getExpirationTime`/
 * `getBlockExpirationTime` both do `Math.ceil(ms / 1000)`) — this adapter's Lua scripts
 * work in milliseconds (Redis' own native TTL unit, `PTTL`/`PEXPIRE`), so every reply is
 * converted here, once, at the boundary. Exported (not just used internally) so it has its
 * own focused unit test independent of a real Redis connection. */
export function parseIncrementReply(reply: ScriptReply): ThrottlerStorageRecord {
  const [totalHits, timeToExpireMs, isBlockedFlag, timeToBlockExpireMs] = reply;

  return {
    totalHits,
    timeToExpire: Math.ceil(timeToExpireMs / 1000),
    isBlocked: isBlockedFlag === 1,
    timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
  };
}

/** ioredis options shared by every command this client issues — ULTRAPLAN 1.6
 * security-review fix (blocking #3): a Redis outage must fail FAST, never hang a request
 * open indefinitely. Contrast with the earlier version of this file (`maxRetriesPerRequest:
 * null`, no `commandTimeout`, default `enableOfflineQueue: true`) — that combination is
 * exactly right for BullMQ's OWN connection (`shared.module.ts`, blocking commands that are
 * SUPPOSED to wait), which is precisely why this adapter needs its own separate client
 * rather than sharing BullMQ's (see the class doc comment below) instead of copying its
 * settings.
 *
 *  - `commandTimeout`: a command that doesn't get a reply within this window rejects
 *    instead of waiting forever — the ONLY protection this adapter relies on to bound
 *    worst-case latency, and it applies regardless of connection state (ioredis starts the
 *    timer the moment `sendCommand()` runs, `Command#setTimeout()`, BEFORE it even checks
 *    whether the underlying socket is writable yet — see `ioredis/built/Redis.js`).
 *  - `enableOfflineQueue` is deliberately left at its DEFAULT (`true`), NOT set to `false`:
 *    an earlier version of this file set it to `false`, reasoning (wrongly) that it was
 *    needed for the "Redis unreachable" case. In practice `enableOfflineQueue: false` rejects
 *    ANY command issued while the client's underlying stream isn't in the `ready` state for
 *    ANY reason — including the perfectly normal, extremely common case of the very first
 *    command issued right after this class is constructed, before the initial TCP
 *    handshake/handshake commands finish (a few ms on a healthy local/VPC connection, but
 *    non-zero) — with `enableOfflineQueue: false` THAT command was rejected immediately with
 *    "Stream isn't writeable and enableOfflineQueue options is false" even though Redis was
 *    completely healthy, which is exactly what made every `RedisThrottlerStorage`
 *    integration test flaky/failing outright (caught by re-running the full integration
 *    suite after applying this fix, not by either review — see this task's own notes). With
 *    the default `true`, that same first command is queued for the few ms until the
 *    connection is actually ready and then sent normally — `commandTimeout` above still
 *    bounds it (and every other command) to `REDIS_COMMAND_TIMEOUT_MS` regardless, so a
 *    GENUINELY unreachable Redis still fails fast; only the "still connecting, but fine"
 *    race is fixed.
 *  - `maxRetriesPerRequest: 1`: one retry, not ioredis' unbounded-until-`commandTimeout`
 *    default — keeps the worst case bounded and predictable.
 *
 * The BACKGROUND connection itself still reconnects on its own default schedule (bounded,
 * ioredis' own default `retryStrategy`) — that's fine and desired (resilience across a
 * transient blip); the settings above only bound how long any ONE in-flight command waits,
 * they don't disable reconnection.
 */
const REDIS_COMMAND_TIMEOUT_MS = 300;

/** How often `logOutageWarnSampled` (below) is allowed to actually emit a `warn` line during
 * a sustained Redis outage — see that method's own doc comment (round-2 security-review fix,
 * MEDIUM). Short enough that an outage is still promptly visible in the logs; long enough
 * that production request volume during an outage doesn't flood log ingestion. Exported only
 * so `redis-throttler-storage-unreachable.int.test.ts` can advance a fake clock past it
 * deterministically, instead of a real `sleep()`/relying on wall-clock timing between tests. */
export const OUTAGE_WARN_INTERVAL_MS = 5_000;

/** Single shared key for every Redis-failure warn this class samples through
 * `SampledWarnLogger` (`increment`'s failure inside `runScript`, AND `reset`'s own
 * failure — round-4 security-review fix, LOW, see `reset()`'s own comment) — deliberately
 * ONE bucket, not one per caller: they're all symptoms of the exact same underlying event (
 * "this Redis instance is currently failing"), so a burst of `increment` failures and a
 * `reset` failure a moment later during the SAME outage should count against the SAME
 * sampling window, not reset it. */
const OUTAGE_WARN_KEY = "outage";

/**
 * `ThrottlerStorage` (`@nestjs/throttler`) backed by Redis instead of the package's
 * default in-memory `Map` — required because this API runs as multiple ECS Fargate tasks
 * behind a load balancer (see the module-level comment above `INCREMENT_SCRIPT`).
 *
 * Deliberately its own small `ioredis` client (like `RedisHealthIndicator`, not shared
 * with BullMQ's connection): BullMQ's own client is internal to `@nestjs/bullmq`'s
 * `Queue`/`Worker` wiring and isn't exposed as a plain `ioredis.Redis` for arbitrary
 * commands — see that module's own comment on why no shared raw client existed yet before
 * this task. Long-lived (NOT `lazyConnect` per call like the health indicator) since this
 * runs on every rate-limited request.
 *
 * **Fail-open policy (ULTRAPLAN 1.6 security-review fix, blocking #3 — an explicit,
 * documented choice, not an oversight):** if Redis itself errors/times out, every method
 * here returns `OPEN_RECORD` (never blocked) instead of propagating the error. The
 * alternative (fail CLOSED — reject every login/register/invite-accept attempt whenever
 * Redis hiccups) would turn this rate limiter into a single point of failure that's WORSE
 * than having none: a brief Redis blip would lock every real user out of authentication
 * entirely, while brute-force protection merely degrading for that same brief window is a
 * far smaller, temporary risk. Every fail-open path logs a `warn` (never silent) so a
 * sustained Redis outage is still observable in the logs/alerts.
 *
 * LGPD / CLAUDE.md rule 10: this class never sees a raw e-mail/token itself — by the time
 * `ThrottlerGuard` (or `IdentifierFailureThrottleInterceptor`) calls `increment`,
 * `key` is already an opaque, pre-hashed value — see those callers' own doc comments for
 * exactly how. This class only ever prefixes that already-opaque value for Redis key
 * namespacing — it doesn't need to (and doesn't) hash anything itself.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly appConfig: AppConfigService;
  // Round-2 security-review fix (MEDIUM), round-4 refactor (LOW) — see
  // `logOutageWarnSampled`'s own doc comment. Every Redis-failure warn in this class
  // (`increment`'s failure inside `runScript` AND `reset`'s own failure) goes through this
  // ONE sampler under `OUTAGE_WARN_KEY`.
  private readonly outageWarnLogger = new SampledWarnLogger(this.logger, OUTAGE_WARN_INTERVAL_MS);

  constructor(appConfig: AppConfigService) {
    this.appConfig = appConfig;
    this.redis = new Redis(appConfig.redisUrl, {
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
    });
    // Without this, ioredis (an EventEmitter) crashes the process on a connection error
    // with no listener (same reasoning as `RedisHealthIndicator`) — logged instead of
    // silently swallowed so a persistent outage is visible.
    this.redis.on("error", (error: Error) => {
      this.logger.error(`Erro na conexão Redis do rate limiter: ${error.message}`);
    });
    this.redis.defineCommand("throttleIncrement", { numberOfKeys: 2, lua: INCREMENT_SCRIPT });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const { hitKey, blockKey } = buildKeys(this.appConfig, key, throttlerName);

    return this.runScript(hitKey, blockKey, ttl, limit, blockDuration);
  }

  /** Clears both keys for `(key, throttlerName)` — called by
   * `IdentifierFailureThrottleInterceptor` on a SUCCESSFUL outcome, so a legitimate user's
   * own success wipes any failure count accumulated against their identifier. Best-effort:
   * a failure here just means a slightly stale count lingers a bit longer, not a security
   * regression (the fail-open default already favors availability over strictness) — never
   * thrown.
   *
   * Round-4 security-review fix (LOW): this failure warn now goes through the SAME
   * `logOutageWarnSampled` sampling as `increment`'s own Redis-failure warn (previously
   * unsampled here) — during a genuine outage, `increment` fails open, the handler runs, and
   * every SUCCESSFUL auth call in flight calls `reset()`, whose own `del` also fails; without
   * sampling that reopened exactly the log-flood path the round-2 fix closed for `increment`,
   * just triggered by a different caller.
   */
  async reset(key: string, throttlerName: string): Promise<void> {
    const { hitKey, blockKey } = buildKeys(this.appConfig, key, throttlerName);

    try {
      await this.redis.del(hitKey, blockKey);
    } catch (error) {
      this.logOutageWarnSampled(messageOf(error));
    }
  }

  private async runScript(
    hitKey: string,
    blockKey: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const client = this.redis as unknown as { throttleIncrement: ThrottleScriptCommand };
      const reply = await client.throttleIncrement(hitKey, blockKey, ttl, limit, blockDuration);
      return parseIncrementReply(reply);
    } catch (error) {
      this.logOutageWarnSampled(messageOf(error));
      return OPEN_RECORD;
    }
  }

  /**
   * Round-2 security-review fix (MEDIUM): logs the fail-open outage warning at most once
   * per `OUTAGE_WARN_INTERVAL_MS`, instead of once per failed Redis command. Since
   * `LoggingThrottlerGuard` is a global `APP_GUARD`, every request already issues at least
   * one command through this class (auth routes issue three: `default` + `strictIp` +
   * `strictIdentifier`) — during a genuine outage that used to mean one `warn` line per
   * command per request, unbounded by traffic volume, drowning real signal and costing
   * log-ingestion money with no counter to alarm on.
   *
   * Round-4 refactor (LOW): now a thin wrapper around the generic `SampledWarnLogger`
   * (extracted so `LoggingThrottlerGuard`/`IdentifierFailureThrottleInterceptor` can reuse
   * the exact same sampling shape for their own "request blocked" warns — see that class'
   * own doc comment) — behavior is unchanged from the round-2 version: one shared bucket
   * (`OUTAGE_WARN_KEY`) for this whole class, since every caller here is a symptom of the
   * same underlying "Redis is failing" event, not something that should get its own
   * independent window. Also now the single sampling point for `reset()`'s own failure warn
   * (round-4 security-review fix, LOW — see that method's own comment), not just
   * `increment`'s.
   */
  private logOutageWarnSampled(errorMessage: string): void {
    this.outageWarnLogger.warn(
      OUTAGE_WARN_KEY,
      `Redis indisponível para rate limiting — permitindo a requisição (fail-open, ver doc do RedisThrottlerStorage): ${errorMessage}`,
    );
  }

  /**
   * `OnApplicationShutdown`, NOT `OnModuleDestroy` (ULTRAPLAN 1.6 security-review fix,
   * blocking #4 — code-reviewer verified against `@nestjs/core`'s actual `close()`
   * sequence): Nest's shutdown runs `callDestroyHook()` (fires every `OnModuleDestroy`)
   * BEFORE `dispose()` (which drains the HTTP server's in-flight requests), but
   * `callShutdownHook()` (fires every `OnApplicationShutdown`) runs AFTER `dispose()`. Using
   * `OnModuleDestroy` here meant this Redis client disconnected WHILE requests on
   * rate-limited routes could still be in flight — on every normal `SIGTERM`/rolling deploy
   * (system-design.md §11, ECS Fargate), any such request would hit an uncaught
   * "Connection is closed" rejection and fall through to a bare 500 instead of completing
   * normally. `OnApplicationShutdown` fixes the ordering; `.disconnect()` (not `.quit()`,
   * unchanged from before) is still the right call itself — same reasoning as before: it
   * immediately clears any pending reconnect timer instead of waiting on a `QUIT`
   * handshake that never resolves cleanly if the connection is mid-reconnect-retry (e.g. a
   * genuinely unreachable Redis — exercised by `test/health.int.test.ts`'s "dependency
   * unreachable" suite, which overrides `AppConfigService.redisUrl` to a bogus address for
   * the WHOLE app, this provider included).
   */
  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "erro desconhecido";
}
