import type { OrganizationRole } from "@neulander/contracts";
import { describe, expect, it } from "vitest";

import { canInviteRole } from "./invite-policy";

const ROLES: OrganizationRole[] = ["owner", "manager", "operator"];

describe("canInviteRole", () => {
  it.each([
    ["owner", "owner", true],
    ["owner", "manager", true],
    ["owner", "operator", true],
    ["manager", "owner", false],
    ["manager", "manager", true],
    ["manager", "operator", true],
    ["operator", "owner", false],
    ["operator", "manager", false],
    ["operator", "operator", false],
  ] as const)("callerRole=%s targetRole=%s -> %s", (callerRole, targetRole, expected) => {
    expect(canInviteRole(callerRole, targetRole)).toBe(expected);
  });

  it("exhaustively covers every role combination (guards against a role added later going untested)", () => {
    const combinations = ROLES.flatMap((callerRole) =>
      ROLES.map((targetRole) => canInviteRole(callerRole, targetRole)),
    );
    expect(combinations).toHaveLength(9);
  });

  it("an operator can never invite anyone, regardless of target role (defense in depth)", () => {
    for (const targetRole of ROLES) {
      expect(canInviteRole("operator", targetRole)).toBe(false);
    }
  });

  it("only an owner may invite an owner", () => {
    expect(canInviteRole("owner", "owner")).toBe(true);
    expect(canInviteRole("manager", "owner")).toBe(false);
    expect(canInviteRole("operator", "owner")).toBe(false);
  });
});
