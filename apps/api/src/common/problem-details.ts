/**
 * RFC 9457 (`application/problem+json`) body — see docs/architecture/api-and-events.md
 * line 12: `{ type, title, status, detail, code, errors? }`. `code` is a stable
 * machine-readable identifier (e.g. `SESSION_ALREADY_OPEN`); generic Nest exceptions
 * today map to generic codes (`VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`, ...).
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  errors?: Record<string, unknown>;
}
