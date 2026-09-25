import { Injectable } from "@nestjs/common";

import type { Database } from "../../../database/database.module";
import type { DomainEvent } from "../domain/domain-event";
import { outboxEvents } from "./schema";

/**
 * Wire envelope actually stored in `outbox_events.payload` — the full `DomainEvent` minus
 * `aggregateType` (that field is only for the table's own `aggregate_type` column, not
 * part of what consumers receive; see docs/architecture/api-and-events.md line 124).
 * `occurredAt` is serialized to an ISO string since `jsonb` has no native `Date` type.
 */
interface StoredEnvelope {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  aggregateId: string;
  organizationId: string;
  payload: Record<string, unknown>;
}

/**
 * Writes a domain event to the transactional outbox (ADR-0007, ULTRAPLAN 0.5). Callers
 * pass the **same Drizzle transaction** they're using for the rest of their use case
 * (`db.transaction(async (tx) => { ...; await outboxService.record(tx, event); })`) — that
 * atomicity (business write + event write commit together, or neither does) is the entire
 * point of the outbox pattern, so `record()` deliberately takes `tx` as a parameter
 * instead of owning/opening its own transaction or connection.
 *
 * Only ever inserts a row — publishing to BullMQ is `OutboxRelayProcessor`'s job, run
 * later, outside this transaction (CLAUDE.md rule 7: never call an external service, Redis
 * included, from inside a DB transaction).
 */
@Injectable()
export class OutboxService {
  async record(tx: Database, event: DomainEvent): Promise<void> {
    const envelope: StoredEnvelope = {
      id: event.id,
      type: event.type,
      version: event.version,
      occurredAt: event.occurredAt.toISOString(),
      aggregateId: event.aggregateId,
      organizationId: event.organizationId,
      payload: event.payload,
    };

    await tx.insert(outboxEvents).values({
      id: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      type: event.type,
      payload: envelope,
      occurredAt: event.occurredAt,
      publishedAt: null,
    });
  }
}
