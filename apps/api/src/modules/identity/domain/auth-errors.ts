// Imported from the pure domain file directly, not `modules/shared`'s public `index.ts`
// barrel — see the matching named exception in `eslint.boundaries.mjs` for why: that
// barrel also re-exports `SharedModule` (Nest/Drizzle/BullMQ wiring), which would eagerly
// evaluate `AppConfigModule` (validates `process.env` at import time) the moment this file
// is imported — breaking `auth-errors.test.ts`, a pure unit test with no `.env` loaded.
import { DomainError } from "../../shared/domain/domain-error";

/**
 * Domain errors for ULTRAPLAN 1.3 (register/login/refresh). Each has a stable `code`
 * (CLAUDE.md rule: "Erros: `DomainError` com `code` estável") that the global
 * `ProblemDetailsExceptionFilter` maps straight to an RFC 9457 body — no HTTP-specific
 * code lives in `application/`/`http/`, only here.
 */

/**
 * `POST /v1/auth/register` with an e-mail that already has a `users` row. `409 Conflict`
 * (not `422`, `DomainError`'s default) — "a resource with this identifier already exists"
 * is squarely what 409 means. Message deliberately does NOT echo the e-mail back (even
 * though the caller already knows it, so there's no real leak) — kept generic on
 * principle, same spirit as CLAUDE.md rule 10's "não logar e-mail ... sem máscara", so
 * nothing about a user's e-mail ever needs to flow through an error message at all.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super("EMAIL_ALREADY_REGISTERED", "E-mail já cadastrado.", 409);
  }
}

/**
 * `POST /v1/auth/login` with a wrong password OR an e-mail that doesn't exist. Exactly
 * one error class for both cases, by design — ULTRAPLAN 1.3's explicit security
 * requirement is that a caller cannot distinguish "no such account" from "wrong password"
 * (a security basic: revealing which one failed would let an attacker enumerate
 * registered e-mails one guess at a time). `401 Unauthorized`.
 */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401);
  }
}

/**
 * `POST /v1/auth/refresh` with a token that isn't a live, valid `refresh_tokens` row —
 * doesn't exist at all, or exists but `expires_at` has passed. Deliberately the SAME error
 * (code/message/status) whether the token is simply unknown or merely expired: neither
 * case is a security event on its own (unlike `RefreshTokenReuseDetectedError` below), and
 * there's no reason to teach a caller how to tell "typo'd/forged token" apart from
 * "correct token, too old" either. `401 Unauthorized`.
 */
export class RefreshTokenInvalidError extends DomainError {
  constructor() {
    super("REFRESH_TOKEN_INVALID", "Refresh token inválido ou expirado.", 401);
  }
}

/**
 * `POST /v1/auth/refresh` with a token that WAS valid but has already been rotated away
 * (`revoked_at` is set) — ADR-0004's reuse-detection case. This is a distinct, more
 * serious signal than `RefreshTokenInvalidError`: presenting an already-rotated token
 * means either the same legitimate client replayed an old token by mistake, or (the
 * scenario this whole mechanism defends against) an attacker is replaying a token they
 * stole earlier, after the legitimate client already moved on to the next one in the
 * chain. Either way, the entire `family_id` is revoked as a side effect (see
 * `RefreshTokenUseCase`) before this is thrown — by the time the caller sees this error,
 * every token descended from that login is already dead. `401 Unauthorized` (not `403`):
 * this is still "your credentials aren't accepted", not "you're recognized but
 * forbidden".
 */
export class RefreshTokenReuseDetectedError extends DomainError {
  constructor() {
    super(
      "REFRESH_TOKEN_REUSE_DETECTED",
      "Reuso de refresh token detectado — todas as sessões desta família foram revogadas.",
      401,
    );
  }
}
