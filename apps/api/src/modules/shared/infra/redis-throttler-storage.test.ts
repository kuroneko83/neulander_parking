import { describe, expect, it } from "vitest";

import { parseIncrementReply } from "./redis-throttler-storage";

/**
 * Unit tests for the pure ms→`ThrottlerStorageRecord` boundary conversion
 * (`parseIncrementReply`) — the one piece of `RedisThrottlerStorage` that's meaningfully
 * unit-testable without a real Redis connection. The Lua script itself (`INCREMENT_SCRIPT`)
 * and the class's actual `increment()` method (atomicity, TTL behavior, the blocking
 * transition) are exercised end-to-end against a real Redis in
 * `test/shared/redis-throttler-storage.int.test.ts` — see that file's own doc comment for
 * why a genuine Redis connection, not a mock, is used there.
 */
describe("parseIncrementReply", () => {
  it("converts a not-blocked reply, rounding the ms TTL up to whole seconds", () => {
    const record = parseIncrementReply([3, 14_001, 0, 0]);

    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 15, // ceil(14001 / 1000)
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it("converts a blocked reply, exposing timeToBlockExpire in seconds for the Retry-After header", () => {
    const record = parseIncrementReply([9, 0, 1, 900_000]);

    expect(record).toEqual({
      totalHits: 9,
      timeToExpire: 0,
      isBlocked: true,
      timeToBlockExpire: 900, // ceil(900000 / 1000) = 15 min in seconds
    });
  });

  it("never returns a fractional second — always rounds up (ceil), never down", () => {
    // 1ms left on the clock must still read as "1 second left", not "0" (which would read
    // as "already expired" to a caller checking `timeToExpire > 0`).
    expect(parseIncrementReply([1, 1, 0, 0]).timeToExpire).toBe(1);
    expect(parseIncrementReply([1, 0, 0, 0]).timeToExpire).toBe(0);
  });

  it("treats isBlocked strictly as the literal 1 flag from the Lua script, not any truthy number", () => {
    expect(parseIncrementReply([1, 100, 0, 0]).isBlocked).toBe(false);
    expect(parseIncrementReply([1, 100, 1, 100]).isBlocked).toBe(true);
  });
});
