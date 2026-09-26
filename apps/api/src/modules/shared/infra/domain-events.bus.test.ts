import type { DomainEvent } from "@neulander/contracts";
import { describe, expect, it, vi } from "vitest";

import { DomainEventBus } from "./domain-events.bus";

function buildEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "01933b6a-1a00-7000-8000-000000000001",
    type: "shared.test_thing_happened.v1",
    version: 1,
    occurredAt: new Date("2026-09-26T12:00:00.000Z"),
    aggregateId: "01933b6a-1a00-7000-8000-000000000002",
    organizationId: "01933b6a-1a00-7000-8000-000000000003",
    payload: {},
    ...overrides,
  };
}

describe("DomainEventBus", () => {
  it("dispatches to a single registered handler with the event itself", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.register("shared.test_thing_happened.v1", handler);

    const event = buildEvent();
    await bus.dispatch(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("dispatches to every handler registered for the same type, in registration order", async () => {
    const bus = new DomainEventBus();
    const order: string[] = [];
    bus.register("shared.test_thing_happened.v1", () => {
      order.push("first");
      return Promise.resolve();
    });
    bus.register("shared.test_thing_happened.v1", () => {
      order.push("second");
      return Promise.resolve();
    });

    await bus.dispatch(buildEvent());

    expect(order).toEqual(["first", "second"]);
  });

  it("never calls a handler registered for a different event type", async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.register("shared.other_thing_happened.v1", handler);

    await bus.dispatch(buildEvent({ type: "shared.test_thing_happened.v1" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("is a no-op (does not throw) for an event type with no registered handler", async () => {
    const bus = new DomainEventBus();

    await expect(bus.dispatch(buildEvent())).resolves.toBeUndefined();
  });

  it("propagates a handler's rejection to the caller", async () => {
    const bus = new DomainEventBus();
    bus.register("shared.test_thing_happened.v1", () => Promise.reject(new Error("boom")));

    await expect(bus.dispatch(buildEvent())).rejects.toThrow("boom");
  });

  it("a later handler for the same type is never called once an earlier one throws", async () => {
    const bus = new DomainEventBus();
    const secondHandler = vi.fn().mockResolvedValue(undefined);
    bus.register("shared.test_thing_happened.v1", () => Promise.reject(new Error("boom")));
    bus.register("shared.test_thing_happened.v1", secondHandler);

    await expect(bus.dispatch(buildEvent())).rejects.toThrow("boom");
    expect(secondHandler).not.toHaveBeenCalled();
  });
});
