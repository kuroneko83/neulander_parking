import { DomainError } from "./domain-error";

/** Mercosul format: 3 letters + 1 digit + 1 letter + 2 digits (e.g. `ABC1D23`). */
const MERCOSUL_PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

/** Legacy (pre-Mercosul) format: 3 letters + 4 digits (e.g. `ABC1234`). */
const LEGACY_PLATE_REGEX = /^[A-Z]{3}[0-9]{4}$/;

/** Uppercases and strips whitespace/dashes so `"abc-1d23"`, `"ABC 1D23"` and `"ABC1D23"`
 * all collapse to the same canonical string before format validation. */
function cleanupPlate(rawPlate: string): string {
  return rawPlate.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Normalizes and validates a plate against the two formats the platform accepts
 * (docs/domain/glossary.md, ULTRAPLAN 0.5): Mercosul (`ABC1D23`) and legacy (`ABC1234`).
 * Throws `DomainError("INVALID_PLATE", ...)` for anything else — callers (controllers,
 * `PlateMatcher` later) are expected to catch/propagate that as a 422, never to store an
 * unnormalized or invalid plate string.
 *
 * The error message uses `maskPlate()` instead of the raw input — CLAUDE.md rule 10
 * ("nunca logar placa ... sem máscara") applies to this message too, since a 500-level
 * catch-all could end up logging `exception.message` (see
 * `ProblemDetailsExceptionFilter`).
 */
export function normalizePlate(rawPlate: string): string {
  const cleaned = cleanupPlate(rawPlate);

  if (MERCOSUL_PLATE_REGEX.test(cleaned) || LEGACY_PLATE_REGEX.test(cleaned)) {
    return cleaned;
  }

  throw new DomainError("INVALID_PLATE", `Placa inválida: "${maskPlate(rawPlate)}"`);
}

/**
 * Masks a plate for logs/UI (CLAUDE.md rule 10 — never log a plate unmasked). Keeps only
 * the first 3 characters (the regional/brand prefix, not identifying on its own) and
 * replaces the rest with `*`. Deliberately lenient — unlike `normalizePlate()`, this never
 * throws, so it's always safe to call on arbitrary/partial user input right before it
 * touches a log line.
 */
export function maskPlate(rawPlate: string): string {
  const cleaned = cleanupPlate(rawPlate);

  if (cleaned.length <= 3) {
    return "*".repeat(cleaned.length);
  }

  const visiblePrefix = cleaned.slice(0, 3);
  const maskedSuffix = "*".repeat(cleaned.length - 3);
  return `${visiblePrefix}${maskedSuffix}`;
}
