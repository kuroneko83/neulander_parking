import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  GlobalRoleSchema,
  LoginInputSchema,
  MembershipSchema,
  MeSchema,
  OrganizationRoleSchema,
  RegisterInputSchema,
  TokenPairSchema,
} from "./identity";

function validRegisterInput() {
  return {
    email: "motorista@example.com",
    password: "correct-horse",
    name: "Ana Souza",
  };
}

describe("RegisterInputSchema", () => {
  it("accepts a valid input without phone", () => {
    expect(RegisterInputSchema.parse(validRegisterInput())).toEqual(validRegisterInput());
  });

  it("accepts a valid input with phone", () => {
    const input = { ...validRegisterInput(), phone: "11987654321" };
    expect(RegisterInputSchema.parse(input)).toEqual(input);
  });

  it("treats phone as truly optional (parses fine when omitted, key absent from output)", () => {
    const parsed = RegisterInputSchema.parse(validRegisterInput());
    expect(parsed.phone).toBeUndefined();
    expect("phone" in parsed).toBe(false);
  });

  it.each(["not-an-email", "missing-at.com", "@missing-local.com", ""])(
    "rejects an invalid email (%s)",
    (email) => {
      expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), email })).toThrow(ZodError);
    },
  );

  it.each(["", "a", "1234567"])("rejects a password shorter than 8 characters (%s)", (password) => {
    expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), password })).toThrow(ZodError);
  });

  it("rejects a password longer than 100 characters", () => {
    const password = "a".repeat(101);
    expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), password })).toThrow(ZodError);
  });

  it("accepts a password at the 8-character minimum boundary", () => {
    expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), password: "12345678" })).not.toThrow();
  });

  it.each(["email", "password", "name"] as const)("rejects when required field %s is missing", (field) => {
    const { [field]: _omitted, ...rest } = validRegisterInput();
    expect(() => RegisterInputSchema.parse(rest)).toThrow(ZodError);
  });

  it.each(["", "a"])("rejects a name shorter than 2 characters (%s)", (name) => {
    expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), name })).toThrow(ZodError);
  });

  it.each(["1234567", "a".repeat(21)])("rejects a phone outside the allowed length (%s)", (phone) => {
    expect(() => RegisterInputSchema.parse({ ...validRegisterInput(), phone })).toThrow(ZodError);
  });
});

describe("LoginInputSchema", () => {
  it("accepts a valid email/password pair", () => {
    const input = { email: "motorista@example.com", password: "anything" };
    expect(LoginInputSchema.parse(input)).toEqual(input);
  });

  it("rejects an invalid email", () => {
    expect(() => LoginInputSchema.parse({ email: "not-an-email", password: "anything" })).toThrow(ZodError);
  });

  it("rejects an empty password", () => {
    expect(() => LoginInputSchema.parse({ email: "motorista@example.com", password: "" })).toThrow(ZodError);
  });

  it("rejects when email is missing", () => {
    expect(() => LoginInputSchema.parse({ password: "anything" })).toThrow(ZodError);
  });

  it("rejects when password is missing", () => {
    expect(() => LoginInputSchema.parse({ email: "motorista@example.com" })).toThrow(ZodError);
  });
});

describe("TokenPairSchema", () => {
  it("accepts a valid { accessToken, refreshToken } shape", () => {
    const pair = { accessToken: "access.jwt.token", refreshToken: "opaque-refresh-token" };
    expect(TokenPairSchema.parse(pair)).toEqual(pair);
  });

  it("rejects when accessToken is missing", () => {
    expect(() => TokenPairSchema.parse({ refreshToken: "r" })).toThrow(ZodError);
  });

  it("rejects when refreshToken is missing", () => {
    expect(() => TokenPairSchema.parse({ accessToken: "a" })).toThrow(ZodError);
  });

  it.each(["accessToken", "refreshToken"] as const)("rejects when %s has the wrong type", (field) => {
    const pair: Record<string, unknown> = { accessToken: "a", refreshToken: "r", [field]: 123 };
    expect(() => TokenPairSchema.parse(pair)).toThrow(ZodError);
  });

  it.each(["accessToken", "refreshToken"] as const)("rejects when %s is an empty string", (field) => {
    const pair = { accessToken: "a", refreshToken: "r", [field]: "" };
    expect(() => TokenPairSchema.parse(pair)).toThrow(ZodError);
  });
});

describe("MembershipSchema", () => {
  it("accepts a valid membership with an empty parkingLotIds (means: all lots)", () => {
    const membership = {
      organizationId: "01933b6a-1a00-7000-8000-000000000001",
      role: "manager",
      parkingLotIds: [],
    };
    expect(MembershipSchema.parse(membership)).toEqual(membership);
  });

  it("rejects a role outside the organization-role enum", () => {
    const membership = {
      organizationId: "01933b6a-1a00-7000-8000-000000000001",
      role: "driver", // valid GlobalRole, invalid OrganizationRole
      parkingLotIds: [],
    };
    expect(() => MembershipSchema.parse(membership)).toThrow(ZodError);
  });

  it("rejects a malformed organizationId", () => {
    const membership = {
      organizationId: "not-a-uuid",
      role: "manager",
      parkingLotIds: [],
    };
    expect(() => MembershipSchema.parse(membership)).toThrow(ZodError);
  });
});

function validMe() {
  return {
    id: "01933b6a-1a00-7000-8000-000000000001",
    email: "owner@example.com",
    name: "Carlos Neulander",
    roleGlobal: null,
    memberships: [] as unknown[],
  };
}

describe("MeSchema", () => {
  it("accepts a valid profile with zero memberships", () => {
    expect(MeSchema.parse(validMe())).toEqual(validMe());
  });

  it("accepts a valid profile with one membership", () => {
    const me = {
      ...validMe(),
      memberships: [
        {
          organizationId: "01933b6a-1a00-7000-8000-000000000002",
          role: "owner",
          parkingLotIds: [],
        },
      ],
    };
    expect(() => MeSchema.parse(me)).not.toThrow();
  });

  it("accepts a valid profile with multiple memberships across organizations", () => {
    const me = {
      ...validMe(),
      memberships: [
        {
          organizationId: "01933b6a-1a00-7000-8000-000000000002",
          role: "manager",
          parkingLotIds: ["01933b6a-1a00-7000-8000-000000000010"],
        },
        {
          organizationId: "01933b6a-1a00-7000-8000-000000000003",
          role: "operator",
          parkingLotIds: [],
        },
      ],
    };
    expect(() => MeSchema.parse(me)).not.toThrow();
  });

  it("accepts roleGlobal as null", () => {
    expect(() => MeSchema.parse({ ...validMe(), roleGlobal: null })).not.toThrow();
  });

  it.each(["driver", "platform_admin"] as const)("accepts roleGlobal as %s", (roleGlobal) => {
    expect(() => MeSchema.parse({ ...validMe(), roleGlobal })).not.toThrow();
  });

  it("accepts an optional phone", () => {
    expect(() => MeSchema.parse({ ...validMe(), phone: "11987654321" })).not.toThrow();
  });

  it("rejects a membership with a role outside the organization-role enum", () => {
    const me = {
      ...validMe(),
      memberships: [
        {
          organizationId: "01933b6a-1a00-7000-8000-000000000002",
          role: "platform_admin", // not a valid OrganizationRole
          parkingLotIds: [],
        },
      ],
    };
    expect(() => MeSchema.parse(me)).toThrow(ZodError);
  });

  it("rejects an invalid roleGlobal value", () => {
    expect(() => MeSchema.parse({ ...validMe(), roleGlobal: "manager" })).toThrow(ZodError);
  });

  it("rejects a malformed id", () => {
    expect(() => MeSchema.parse({ ...validMe(), id: "not-a-uuid" })).toThrow(ZodError);
  });

  it.each(["id", "email", "name", "memberships"] as const)("rejects when required field %s is missing", (field) => {
    const { [field]: _omitted, ...rest } = validMe();
    expect(() => MeSchema.parse(rest)).toThrow(ZodError);
  });

  it("rejects when roleGlobal is missing (required-but-nullable, not optional)", () => {
    const { roleGlobal: _roleGlobal, ...rest } = validMe();
    expect(() => MeSchema.parse(rest)).toThrow(ZodError);
  });
});

describe("GlobalRoleSchema", () => {
  it.each(["driver", "platform_admin"] as const)("accepts %s", (value) => {
    expect(GlobalRoleSchema.parse(value)).toBe(value);
  });

  it("rejects an arbitrary value", () => {
    expect(() => GlobalRoleSchema.parse("owner")).toThrow(ZodError);
  });
});

describe("OrganizationRoleSchema", () => {
  it.each(["owner", "manager", "operator"] as const)("accepts %s", (value) => {
    expect(OrganizationRoleSchema.parse(value)).toBe(value);
  });

  it("rejects an arbitrary value", () => {
    expect(() => OrganizationRoleSchema.parse("driver")).toThrow(ZodError);
  });
});
