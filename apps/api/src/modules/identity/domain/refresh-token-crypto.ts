import { createHash, randomBytes } from "node:crypto";

/**
 * Pure crypto helpers for the opaque refresh token (ADR-0004: "refresh token opaco (30
 * dias) armazenado como hash"). Node's built-in `crypto` — like `id.ts`'s `uuid` import —
 * isn't a "framework" dependency (no Nest/Drizzle), so this stays in `domain/` per
 * CLAUDE.md rule 2, unlike `PasswordHasher` (which needs `AppConfigService` for the
 * pepper and therefore lives in `infra/`).
 *
 * Decision: SHA-256 (`hashOpaqueToken`), not argon2id, for hashing the refresh token
 * itself — unlike a user-chosen password, this token is 256 bits of `randomBytes` output
 * (`generateOpaqueRefreshToken`), already far outside brute-force range. Argon2id's
 * deliberate slowness exists to blunt guessing a *low-entropy, human-chosen* secret; here
 * it would only add latency to every `/v1/auth/refresh` call for no security benefit — a
 * single fast cryptographic hash already makes the stored `refresh_tokens.token_hash`
 * useless to an attacker without the original opaque token (data-model.md: "token_hash ...
 * armazenado" — never the raw token).
 */

/** 256 bits of randomness, hex-encoded — the refresh token a client actually holds
 * (SecureStore on mobile, an `HttpOnly` cookie on web per ADR-0004). Never stored as-is;
 * only `hashOpaqueToken`'s output goes in `refresh_tokens.token_hash`. */
export function generateOpaqueRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

/** Deterministic, one-way digest of a refresh token — the lookup key for
 * `refresh_tokens.token_hash` (`unique`, data-model.md). Same input always produces the
 * same output (unlike a password hash's random salt) precisely because this needs to be
 * looked up by equality, not verified by a separate `verify()` call. */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
