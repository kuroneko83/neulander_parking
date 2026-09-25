import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { DomainEventSchema } from "./events";

function validEnvelope() {
  return {
    id: "01933b6a-1a00-7000-8000-000000000001",
    type: "sessions.session_started.v1",
    version: 1,
    occurredAt: new Date("2026-09-25T12:00:00.000Z"),
    aggregateId: "01933b6a-1a00-7000-8000-000000000002",
    organizationId: "01933b6a-1a00-7000-8000-000000000003",
    payload: { note: "fixture" },
  };
}

describe("DomainEventSchema", () => {
  it("parses a valid envelope, including a UUID v7 id/aggregateId (not v1-v5)", () => {
    const parsed = DomainEventSchema.parse(validEnvelope());
    expect(parsed).toEqual(validEnvelope());
  });

  it("accepts an arbitrary payload shape (record of unknown values)", () => {
    const envelope = { ...validEnvelope(), payload: { plate: "ABC1D23", amountCents: 1200 } };
    expect(() => DomainEventSchema.parse(envelope)).not.toThrow();
  });

  it.each([
    ["id", "not-a-uuid"],
    ["type", ""],
    ["version", 0],
    ["version", 1.5],
    ["occurredAt", "2026-09-25T12:00:00.000Z"], // string, not a Date instance
    ["aggregateId", "not-a-uuid"],
    ["organizationId", "not-a-uuid"],
    ["payload", "not-an-object"],
  ])("rejects an envelope with an invalid %s (%s)", (field, badValue) => {
    const envelope = { ...validEnvelope(), [field]: badValue };
    expect(() => DomainEventSchema.parse(envelope)).toThrow(ZodError);
  });

  it("rejects an envelope missing a required field", () => {
    const { aggregateId: _aggregateId, ...withoutAggregateId } = validEnvelope();
    expect(() => DomainEventSchema.parse(withoutAggregateId)).toThrow(ZodError);
  });
});
