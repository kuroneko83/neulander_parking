/**
 * Base class for every domain-level error in the codebase (ULTRAPLAN 0.5,
 * system-design.md §6: `shared` kernel owns `DomainError`). Pure TS — no Nest/Drizzle
 * import at all (domain/ stays framework-free per CLAUDE.md rule 2), so `httpStatus`
 * below is a plain number literal, not Nest's `HttpStatus` enum.
 *
 * Every future domain module throws a **subclass** with a stable, machine-readable
 * `code` (e.g. `SESSION_ALREADY_OPEN`, `SPOT_UNAVAILABLE` — see
 * docs/architecture/api-and-events.md line 12) instead of a generic Nest `HttpException`.
 * `ProblemDetailsExceptionFilter` (apps/api/src/common) catches `DomainError` and maps it
 * to the RFC 9457 `application/problem+json` body using `httpStatus`/`code`/`message`.
 *
 * `httpStatus` defaults to 422 (Unprocessable Entity — "the request was well-formed but
 * violates a business rule"), the right default for most domain errors; pass a different
 * one for errors that map to a more specific status (e.g. 409 Conflict for the
 * `Idempotency-Key` mismatch case in `infra/idempotency.interceptor.ts`).
 */
export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 422, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    // Keeps `instanceof DomainError` working for subclasses when compiled down to
    // ES2023 targets under CommonJS (see the `.tsconfig`'s `module: "commonjs"` note).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
