import { describe, expect, it } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import {
  InvitationAcceptMissingCredentialsError,
  InvitationAlreadyPendingError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InviteRoleNotAllowedError,
  MemberAlreadyExistsError,
  ParkingLotScopeUnavailableError,
} from "./invitation-errors";

describe("InviteRoleNotAllowedError", () => {
  it("is a DomainError with a stable code and 403", () => {
    const error = new InviteRoleNotAllowedError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVITE_ROLE_NOT_ALLOWED");
    expect(error.httpStatus).toBe(403);
    expect(error.message).toBeTruthy();
  });
});

describe("ParkingLotScopeUnavailableError", () => {
  it("is a DomainError with a stable code and 400", () => {
    const error = new ParkingLotScopeUnavailableError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("PARKING_LOT_SCOPE_UNAVAILABLE");
    expect(error.httpStatus).toBe(400);
  });
});

describe("MemberAlreadyExistsError", () => {
  it("is a DomainError with a stable code and 409", () => {
    const error = new MemberAlreadyExistsError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("MEMBER_ALREADY_EXISTS");
    expect(error.httpStatus).toBe(409);
  });
});

describe("InvitationAlreadyPendingError", () => {
  it("is a DomainError with a stable code and 409", () => {
    const error = new InvitationAlreadyPendingError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVITATION_ALREADY_PENDING");
    expect(error.httpStatus).toBe(409);
  });
});

describe("InvitationNotFoundError", () => {
  it("is a DomainError with a stable code and 404", () => {
    const error = new InvitationNotFoundError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVITATION_NOT_FOUND");
    expect(error.httpStatus).toBe(404);
  });

  it("carries the exact same code/message regardless of why the token didn't resolve", () => {
    // ULTRAPLAN 1.5's security requirement for GET /v1/invitations/:token: there's only
    // ever one way to construct this error — no constructor argument distinguishes
    // "unknown token" from "expired"/"revoked"/"already accepted".
    const a = new InvitationNotFoundError();
    const b = new InvitationNotFoundError();

    expect(a.code).toBe(b.code);
    expect(a.message).toBe(b.message);
  });
});

describe("InvitationExpiredError", () => {
  it("is a DomainError with a stable code and 410", () => {
    const error = new InvitationExpiredError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVITATION_EXPIRED");
    expect(error.httpStatus).toBe(410);
  });

  it("is distinct from InvitationNotFoundError (different `code`)", () => {
    const expired = new InvitationExpiredError();
    const notFound = new InvitationNotFoundError();

    expect(expired.code).not.toBe(notFound.code);
  });
});

describe("InvitationAcceptMissingCredentialsError", () => {
  it("is a DomainError with a stable code and 400", () => {
    const error = new InvitationAcceptMissingCredentialsError();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe("INVITATION_ACCEPT_MISSING_CREDENTIALS");
    expect(error.httpStatus).toBe(400);
  });
});
