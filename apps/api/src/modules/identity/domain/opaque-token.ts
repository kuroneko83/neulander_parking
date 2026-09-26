import { createHash, randomBytes } from "node:crypto";

/**
 * Pure crypto helpers for opaque, random secret tokens — Node's built-in `crypto` (like
 * `id.ts`'s `uuid` import) isn't a "framework" dependency (no Nest/Drizzle), so this stays
 * in `domain/` per CLAUDE.md rule 2, unlike `PasswordHasher` (which needs
 * `AppConfigService` for the pepper and therefore lives in `infra/`).
 *
 * Originally `refresh-token-crypto.ts` (ULTRAPLAN 1.3, refresh tokens only). Renamed and
 * generalized (ULTRAPLAN 1.5): `invitations.token_hash` (data-model.md) is the exact same
 * shape of secret — a 256-bit random opaque value, stored only as a hash, looked up by
 * equality — so `generateOpaqueRefreshToken()` became `generateOpaqueToken()`, with no
 * change to its behavior, rather than `InviteMemberUseCase`/`AcceptInvitationUseCase`
 * duplicating an identical pair of functions under a different name.
 *
 * Decision (unchanged from the original file): SHA-256 (`hashOpaqueToken`), not argon2id,
 * for hashing the token itself — unlike a user-chosen password, this token is 256 bits of
 * `randomBytes` output (`generateOpaqueToken`), already far outside brute-force range.
 * Argon2id's deliberate slowness exists to blunt guessing a *low-entropy, human-chosen*
 * secret; here it would only add latency to every lookup for no security benefit — a single
 * fast cryptographic hash already makes the stored hash useless to an attacker without the
 * original opaque token (data-model.md: "token_hash ... armazenado" — never the raw token).
 */

/** 256 bits of randomness, hex-encoded — the opaque token a client actually holds (a
 * refresh token in `SecureStore`/an `HttpOnly` cookie per ADR-0004; an invitation's accept
 * token, e-mailed once by `notifications`). Never stored as-is; only `hashOpaqueToken`'s
 * output is persisted (`refresh_tokens.token_hash`/`invitations.token_hash`). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

/** Deterministic, one-way digest of an opaque token — the lookup key for
 * `refresh_tokens.token_hash`/`invitations.token_hash` (both `unique`, data-model.md). Same
 * input always produces the same output (unlike a password hash's random salt) precisely
 * because this needs to be looked up by equality, not verified by a separate `verify()`
 * call. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
