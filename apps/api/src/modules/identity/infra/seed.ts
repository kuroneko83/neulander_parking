/**
 * `db:seed`'s identity step (ULTRAPLAN 1.2 — first real seed step; `apps/api/src/database/
 * seed.ts` previously only logged "nenhuma tabela para semear ainda"). Seeds exactly what
 * the task asks for: 1 `platform_admin` (no membership), 1 demo organization, one
 * membership per organization role (`owner`/`manager`/`operator`), and 1 `driver` (no
 * membership — drivers are never organization members in this data model).
 *
 * **Users, one per role — no accumulation.** Each of the 5 seeded users holds exactly one
 * role (either `role_global` or one membership role), never both and never more than one
 * membership: a `platform_admin` with a demo-org membership, or one user holding two
 * different membership roles, would demo nothing extra about the schema (every table's
 * shape is already exercised by 5 distinct rows) while making it *less* obvious, reading
 * the seed, which login demonstrates which role — the entire point of a demo seed.
 *
 * **`password_hash` — real argon2id hash of a known password, not a placeholder string.**
 * Decision, since the task leaves it open: added the `argon2` dependency now and hash a
 * documented demo password (`DEMO_SEED_PASSWORD` below, also called out in the root
 * `README.md`) with real argon2id (ADR-0004's algorithm), rather than a placeholder like
 * `"seed-placeholder-hash"`. Two reasons: (1) this is a portfolio project — a demo seed
 * whose accounts cannot actually log in once ULTRAPLAN 1.3 ships is a worse demo than one
 * that works end-to-end the moment login lands; (2) ULTRAPLAN 1.3 needs `argon2` as a
 * dependency anyway (ADR-0004), so adding it here isn't pulling in a library this task
 * wouldn't otherwise justify — it's using the same one a few tasks early, for exactly the
 * one thing this task needs (hashing 5 known strings), with zero login/verification logic
 * written here (`argon2.hash()` only — no `argon2.verify()`, no controller, no guard; that
 * remains entirely ULTRAPLAN 1.3/1.4's job). `type: argon2id` is passed explicitly rather
 * than relied on as the library default, so this keeps working even if that default ever
 * changes upstream.
 *
 * **Idempotency**: every insert targets its own unique constraint with
 * `onConflictDoNothing` (`users.email`, `organizations.cnpj`,
 * `memberships(organization_id, user_id)`) — running this twice leaves row counts
 * unchanged. Because a conflicted insert returns nothing (not even the existing row), user/
 * organization ids are always re-resolved by a follow-up `select` on the same unique key
 * rather than trusted from the locally generated `newId()` — otherwise the second run would
 * try to insert memberships pointing at ids that were never actually written on the first
 * run's conflict path.
 */
import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { newId } from "../../shared";
import { memberships, organizations, users } from "./schema";

/**
 * Demo password for every seeded account (documented in `README.md`, "Seed de dados de
 * demonstração"). Not a secret — this is dev/CI seed data, never production data (CLAUDE.md
 * rule 10 doesn't apply to a known, published demo credential).
 */
export const DEMO_SEED_PASSWORD = "senha123";

/** `organizations.cnpj` of the demo org, exported so
 * `test/identity/seed.int.test.ts` can look it up without hardcoding a second copy of this
 * literal (and without ever needing to know how the test scopes its assertions). */
export const DEMO_ORGANIZATION_CNPJ = "00000000000191";

/** The exact 5 emails this step seeds, in the order `seedIdentity` creates them — exported
 * for the same reason as `DEMO_ORGANIZATION_CNPJ`: a single source of truth for "which rows
 * are this seed step's", so `seed.int.test.ts`'s idempotency assertion can scope its row
 * counts to exactly these rows instead of the whole `users` table (a whole-table count
 * would be wrong the moment any other seed step, or a developer's own manual data, adds
 * unrelated rows — and flaky under parallel integration test files touching the same
 * long-lived database). */
export const DEMO_SEED_EMAILS = [
  "admin@neulander.dev",
  "dono@estacionamento-demo.neulander.dev",
  "gestor@estacionamento-demo.neulander.dev",
  "operador@estacionamento-demo.neulander.dev",
  "motorista@neulander.dev",
] as const;

interface SeedUserInput {
  email: string;
  name: string;
  roleGlobal?: "driver" | "platform_admin";
}

/** Inserts a `users` row if `email` doesn't already exist, then returns its id either way
 * (freshly inserted, or the pre-existing row's) — the idempotent-insert pattern this whole
 * file follows for every table with a natural unique key. */
async function ensureUser(
  db: NodePgDatabase,
  passwordHash: string,
  input: SeedUserInput,
): Promise<string> {
  const inserted = await db
    .insert(users)
    .values({
      id: newId(),
      email: input.email,
      passwordHash,
      name: input.name,
      roleGlobal: input.roleGlobal,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  if (inserted[0]) {
    return inserted[0].id;
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (!existing) {
    throw new Error(`[db:seed] identity: falha ao localizar usuário "${input.email}" após conflito de e-mail.`);
  }
  return existing.id;
}

/** Same idempotent-insert-then-resolve pattern as `ensureUser`, keyed by `cnpj`. */
async function ensureOrganization(
  db: NodePgDatabase,
  input: { name: string; legalName: string; cnpj: string },
): Promise<string> {
  const inserted = await db
    .insert(organizations)
    .values({ id: newId(), name: input.name, legalName: input.legalName, cnpj: input.cnpj })
    .onConflictDoNothing({ target: organizations.cnpj })
    .returning({ id: organizations.id });

  if (inserted[0]) {
    return inserted[0].id;
  }

  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.cnpj, input.cnpj));
  if (!existing) {
    throw new Error(`[db:seed] identity: falha ao localizar organização "${input.cnpj}" após conflito de CNPJ.`);
  }
  return existing.id;
}

/** `memberships` has no other seed step depending on its id, so — unlike `ensureUser`/
 * `ensureOrganization` — this only needs to be a no-op on repeat, not also resolve/return
 * anything. */
async function ensureMembership(
  db: NodePgDatabase,
  input: { organizationId: string; userId: string; role: "owner" | "manager" | "operator" },
): Promise<void> {
  await db
    .insert(memberships)
    .values({
      id: newId(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
    })
    .onConflictDoNothing({ target: [memberships.organizationId, memberships.userId] });
}

/**
 * Seeds: `platform_admin` (no membership) · demo org "Estacionamento Demo" · owner/manager/
 * operator memberships in it (3 distinct users — see file header) · 1 `driver` (no
 * membership). Called from `apps/api/src/database/seed.ts`'s `runSeed`.
 */
export async function seedIdentity(db: NodePgDatabase): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_SEED_PASSWORD, { type: argon2.argon2id });

  const [adminEmail, ownerEmail, managerEmail, operatorEmail, driverEmail] = DEMO_SEED_EMAILS;

  await ensureUser(db, passwordHash, {
    email: adminEmail,
    name: "Admin da Plataforma",
    roleGlobal: "platform_admin",
  });

  const organizationId = await ensureOrganization(db, {
    name: "Estacionamento Demo",
    legalName: "Estacionamento Demo Ltda.",
    // Placeholder CNPJ — not a real registered company's number (it happens to pass the
    // check-digit algorithm, but the schema has no CHECK for that and no flow validates CNPJ
    // format yet); only needs to be unique for the seed.
    cnpj: DEMO_ORGANIZATION_CNPJ,
  });

  const ownerId = await ensureUser(db, passwordHash, {
    email: ownerEmail,
    name: "Dono do Estacionamento Demo",
  });
  await ensureMembership(db, { organizationId, userId: ownerId, role: "owner" });

  const managerId = await ensureUser(db, passwordHash, {
    email: managerEmail,
    name: "Gestor do Estacionamento Demo",
  });
  await ensureMembership(db, { organizationId, userId: managerId, role: "manager" });

  const operatorId = await ensureUser(db, passwordHash, {
    email: operatorEmail,
    name: "Operador do Estacionamento Demo",
  });
  await ensureMembership(db, { organizationId, userId: operatorId, role: "operator" });

  await ensureUser(db, passwordHash, {
    email: driverEmail,
    name: "Motorista Demo",
    roleGlobal: "driver",
  });
}
