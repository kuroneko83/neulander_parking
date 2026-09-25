/** Shared by `DatabaseModule` (Nest DI pool) and the standalone `db:migrate`/`db:seed`
 * scripts (their own short-lived `Pool`) so every Postgres connection in `apps/api` fails
 * fast the same way instead of hanging forever when the database is unreachable. */
export const CONNECTION_TIMEOUT_MS = 5_000;
