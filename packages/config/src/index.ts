/**
 * Throws at runtime and forces a compile-time exhaustiveness check when placed in the
 * `default` branch of a `switch` over a union type. Intended for the explicit state
 * machines the project requires (ParkingSession, Reservation, Payment — see
 * docs/architecture/flows.md and CLAUDE.md rule 8): an unhandled case fails to compile
 * instead of silently falling through.
 *
 * @param value - a value the type checker has already narrowed to `never`.
 * @param context - optional label (e.g. the state machine name) included in the error.
 */
export function assertNever(value: never, context?: string): never {
  throw new Error(`Unhandled case${context ? ` in ${context}` : ""}: ${JSON.stringify(value)}`);
}
