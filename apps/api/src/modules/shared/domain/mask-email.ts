/**
 * Masks an e-mail for logs (ULTRAPLAN 1.5, CLAUDE.md rule 10 — "não logar ... e-mail ... em
 * claro"). Mirrors `plate.ts`'s `maskPlate()` exactly: never throws (safe to call right
 * before a log line on arbitrary/partial user input), keeps a small, non-identifying prefix
 * visible and masks the rest.
 *
 * Kept simpler than a "real" e-mail masking scheme (no attempt to preserve the domain part
 * unmasked, no special-casing very short local parts beyond what falls out of the same
 * rules `maskPlate()` already uses) — this exists for log lines/error messages, not for a
 * UI that needs to show "which account" a masked value refers to.
 */
export function maskEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const atIndex = trimmed.indexOf("@");

  // No '@' at all, or an empty local part (e.g. "@example.com") — nothing meaningful to
  // split into local-part/domain, so mask the whole thing rather than guess.
  if (atIndex <= 0) {
    return "*".repeat(trimmed.length);
  }

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  const maskedLocalPart = `${visiblePrefix}${"*".repeat(localPart.length - 1)}`;

  return `${maskedLocalPart}@${domain}`;
}
