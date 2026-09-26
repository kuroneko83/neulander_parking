import { describe, expect, it } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  RefreshTokenInvalidError,
  RefreshTokenReuseDetectedError,
} from "./auth-errors";

describe("EmailAlreadyRegisteredError", () => {
  it("is a DomainError with a stable code and 409", () => {
    const error = new EmailAlreadyRegisteredError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(error.httpStatus).toBe(409);
    expect(error.message).toBeTruthy();
  });
});

describe("InvalidCredentialsError", () => {
  it("is a DomainError with a stable code and 401", () => {
    const error = new InvalidCredentialsError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(error.httpStatus).toBe(401);
  });

  it("carries the exact same code/message regardless of which login step failed", () => {
    // The whole point of this error (ULTRAPLAN 1.3's security requirement) is that
    // there's only ever ONE way to construct it — no constructor argument distinguishes
    // "wrong password" from "no such user".
    const a = new InvalidCredentialsError();
    const b = new InvalidCredentialsError();

    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
  });
});

describe("RefreshTokenInvalidError", () => {
  it("is a DomainError with a stable code and 401", () => {
    const error = new RefreshTokenInvalidError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("REFRESH_TOKEN_INVALID");
    expect(error.httpStatus).toBe(401);
  });
});

describe("RefreshTokenReuseDetectedError", () => {
  it("is a DomainError with a stable code and 401", () => {
    const error = new RefreshTokenReuseDetectedError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("REFRESH_TOKEN_REUSE_DETECTED");
    expect(error.httpStatus).toBe(401);
  });

  it("is distinct from RefreshTokenInvalidError (different `code`)", () => {
    const reuse = new RefreshTokenReuseDetectedError();
    const invalid = new RefreshTokenInvalidError();

    expect(reuse.code).not.toBe(invalid.code);
  });
});
