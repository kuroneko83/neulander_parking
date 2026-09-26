/**
 * Public API of the `shared` kernel module (ULTRAPLAN 0.5, CLAUDE.md rule 1: "Cada
 * módulo da API expõe apenas seu `index.ts`"). Every other module imports from
 * `modules/shared` — never from `modules/shared/domain/...` or `modules/shared/infra/...`
 * directly.
 */

// --- domain (pure) ---
export { type Clock, FakeClock } from "./domain/clock";
export { DomainError } from "./domain/domain-error";
export type { DomainEvent } from "./domain/domain-event";
export { escapeHtml } from "./domain/escape-html";
export { newId } from "./domain/id";
export { maskEmail } from "./domain/mask-email";
export { maskPlate, normalizePlate } from "./domain/plate";

// Note: `Cents`/`toCents`/etc. moved to `@neulander/contracts` (ULTRAPLAN 0.6) — it's a
// wire-level contract shared with web/mobile, not an API-internal kernel concept, so other
// modules import it directly from `@neulander/contracts` (same as they'd import `zod`
// itself), not through this barrel.

// --- infra (Nest/Drizzle wiring) ---
// Note: `infra/schema.ts`'s tables (`outboxEvents`, `idempotencyKeys`) are deliberately
// NOT re-exported here — only `OutboxService`/`IdempotencyInterceptor` (both internal to
// this module) ever query them, per CLAUDE.md rule 2 ("código de um módulo não faz JOIN
// em tabela de outro"). `apps/api/src/database/schema.ts` still re-exports them directly
// from `infra/schema.ts` (bypassing this `index.ts`), but that barrel exists purely for
// `drizzle-kit` tooling, not for application code to import from.
export { DomainEventBus, type DomainEventHandler } from "./infra/domain-events.bus";
export { DomainEventsProcessor } from "./infra/domain-events.processor";
export { IdempotencyInterceptor } from "./infra/idempotency.interceptor";
export { OutboxService } from "./infra/outbox.service";
export { DOMAIN_EVENTS_QUEUE, OutboxRelayProcessor } from "./infra/outbox-relay.processor";
export { CLOCK, SystemClock } from "./infra/system-clock";

// --- module ---
export { SharedModule } from "./shared.module";
