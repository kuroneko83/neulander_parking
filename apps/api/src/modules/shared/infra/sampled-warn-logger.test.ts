import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SampledWarnLogger } from "./sampled-warn-logger";

describe("SampledWarnLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always logs the first occurrence for a key immediately — never delays the first sign of trouble", () => {
    const logger = new Logger("test");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const sampled = new SampledWarnLogger(logger, 5_000);

    sampled.warn("routeA", "algo aconteceu");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("algo aconteceu");
  });

  it("suppresses repeats of the SAME key within the interval, with no suffix on the (only) logged call", () => {
    const logger = new Logger("test");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");
    const sampled = new SampledWarnLogger(logger, 5_000);

    nowSpy.mockReturnValue(1_000);
    sampled.warn("routeA", "primeira ocorrência");

    nowSpy.mockReturnValue(1_100);
    sampled.warn("routeA", "segunda ocorrência");
    nowSpy.mockReturnValue(2_000);
    sampled.warn("routeA", "terceira ocorrência");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("primeira ocorrência");
  });

  it("logs again once the interval elapses, noting the suppressed count from the burst", () => {
    const logger = new Logger("test");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");
    const sampled = new SampledWarnLogger(logger, 5_000);

    nowSpy.mockReturnValue(1_000);
    sampled.warn("routeA", "primeira");
    nowSpy.mockReturnValue(1_500);
    sampled.warn("routeA", "suprimida 1");
    nowSpy.mockReturnValue(2_000);
    sampled.warn("routeA", "suprimida 2");

    nowSpy.mockReturnValue(1_000 + 5_000 + 1);
    sampled.warn("routeA", "depois do intervalo");

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const secondMessage = warnSpy.mock.calls[1]?.[0] as string;
    expect(secondMessage).toContain("depois do intervalo");
    expect(secondMessage).toContain("2");
    expect(secondMessage.toLowerCase()).toContain("suprimid");
  });

  it("tracks each key's window independently — a burst on one key never suppresses another key's first warn", () => {
    const logger = new Logger("test");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const nowSpy = vi.spyOn(Date, "now");
    const sampled = new SampledWarnLogger(logger, 5_000);

    nowSpy.mockReturnValue(1_000);
    sampled.warn("routeA", "A - primeira");
    nowSpy.mockReturnValue(1_100);
    sampled.warn("routeA", "A - suprimida");

    // Different key, well within routeA's own suppression window — must still log
    // immediately, since it's this key's own FIRST occurrence.
    nowSpy.mockReturnValue(1_200);
    sampled.warn("routeB", "B - primeira");

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(1, "A - primeira");
    expect(warnSpy).toHaveBeenNthCalledWith(2, "B - primeira");
  });

  it("defaults to SAMPLED_WARN_INTERVAL_MS when no interval is given", () => {
    const logger = new Logger("test");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const sampled = new SampledWarnLogger(logger);

    sampled.warn("routeA", "primeira");
    sampled.warn("routeA", "suprimida (mesmo instante)");

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
