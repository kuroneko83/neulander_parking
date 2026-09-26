import { Inject, Injectable } from "@nestjs/common";
import type { RegisterInput } from "@neulander/contracts";

import { type Database, DATABASE_CONNECTION } from "../../../database/database.module";
import { CLOCK, type Clock, newId, OutboxService } from "../../shared";
import {
  type InsertUserInput,
  PASSWORD_HASHER,
  type PasswordHasherPort,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from "./ports";

export interface RegisterUserResult {
  id: string;
}

/**
 * `POST /v1/auth/register` (ULTRAPLAN 1.3, api-and-events.md: "Cadastro de motorista" —
 * público). `roleGlobal` is hardcoded to `"driver"`, never taken from the request: this
 * endpoint is the *public self-registration* path, not how `platform_admin`/organization
 * members come to exist (today: `db:seed`; later: `POST /v1/orgs` and the membership
 * invite flow, ULTRAPLAN 1.5) — nothing about `RegisterInput` (packages/contracts) lets a
 * caller ask for a different role, by design.
 *
 * Publishes `identity.user_registered.v1` to the outbox in the SAME transaction as the
 * `users` insert (CLAUDE.md rule: outbox write + business write commit together or not at
 * all). `api-and-events.md`'s event table lists this event's only documented consumer as
 * `notifications` (boas-vindas) — that module doesn't exist yet, so this only ever
 * publishes to the outbox; nothing consumes it today, same as `OutboxService`'s own doc
 * comment anticipates ("no handler consumidor" is expected at this stage).
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasherPort,
    private readonly outboxService: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterUserResult> {
    // Hashed BEFORE opening the transaction: CLAUDE.md rule 7 ("nunca chame serviço
    // externo dentro de transação") is about network calls, and argon2id is CPU-bound
    // in-process, not a network dependency — but there's no reason to hold a DB
    // transaction open for the ~100ms argon2id itself takes either way, so it happens
    // first regardless.
    const passwordHash = await this.passwordHasher.hash(input.password);
    const userId = newId();
    const now = this.clock.now();

    const insertInput: InsertUserInput = {
      id: userId,
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      roleGlobal: "driver",
    };

    await this.db.transaction(async (tx) => {
      await this.usersRepository.insert(tx, insertInput);

      await this.outboxService.record(tx, {
        id: newId(),
        type: "identity.user_registered.v1",
        version: 1,
        occurredAt: now,
        aggregateType: "User",
        aggregateId: userId,
        // Decision — not pinned by data-model.md/api-and-events.md: a self-registered
        // driver has no organization, but `DomainEventSchema.organizationId`
        // (packages/contracts/src/events.ts) is a required UUID, not nullable/optional.
        // This is the first event this codebase actually publishes for a user-scoped (not
        // org-scoped) aggregate, so there's no existing convention to follow yet. Using
        // the new user's own id (== `aggregateId`) keeps the envelope valid without
        // inventing a sentinel/nullable org id in the shared contract for one event type;
        // `notifications` (the only documented consumer, once it exists) reads
        // `payload.userId`/`payload.email` for this event, not `organizationId`.
        organizationId: userId,
        payload: { userId, email: input.email, name: input.name },
      });
    });

    return { id: userId };
  }
}
