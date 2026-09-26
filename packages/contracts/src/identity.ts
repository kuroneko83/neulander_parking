import { z } from "zod";

/**
 * Identity/auth contracts (ULTRAPLAN 1.1): `RegisterInput`, `LoginInput`, `TokenPair`, `Me`,
 * and the two role enums, per `docs/architecture/api-and-events.md` ("Auth & identidade":
 * `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/me`) and
 * `docs/architecture/data-model.md`'s `identity` module (`users`, `memberships`).
 *
 * This is contracts-only (CLAUDE.md rule 3, "Contratos primeiro"): no controller, use case,
 * or migration lives here — that's ULTRAPLAN 1.2/1.3/1.4. Everything below is deliberately
 * scoped to what those tasks will need to validate at the HTTP boundary.
 */

/**
 * `users.role_global` (`docs/architecture/data-model.md`, `identity` table): a role that
 * applies to the user across the whole platform, independent of any organization membership.
 * `driver` is the default/implicit role for a self-registered user (see glossary.md: "Motorista
 * | Usuário do app mobile"); `platform_admin` is the operator-of-the-platform role that can
 * create organizations (`POST /v1/orgs`). The column is nullable in the data model (most users
 * — owners, managers, operators — have no global role at all, only membership roles), so
 * consumers of `GlobalRoleSchema` must handle absence separately (see `MeSchema.roleGlobal`,
 * modeled as nullable rather than baking "no role" into the enum itself).
 */
export const GlobalRoleSchema = z.enum(["driver", "platform_admin"]);
export type GlobalRole = z.infer<typeof GlobalRoleSchema>;

/**
 * `memberships.role` (`docs/architecture/data-model.md`, `identity` table): a role scoped to
 * one `organization_id` — a user can hold a different `OrganizationRole` per organization via
 * separate membership rows. Maps to glossary.md's Proprietário/Gestor/Operador:
 * `owner` (Proprietário) > `manager` (Gestor) > `operator` (Operador/Manobrista/Caixa).
 *
 * Deliberately kept as its own schema rather than unioned with `GlobalRoleSchema` into one
 * `Role` enum: the two enums validate different, non-overlapping columns
 * (`users.role_global` vs. `memberships.role`) with different nullability rules (global role
 * is nullable/absent; membership role is always required — a membership row without a role
 * makes no sense). A single unified enum would let e.g. `"driver"` parse successfully as a
 * membership role, or `"owner"` as a global role — values the real schema never allows in that
 * column — silently defeating the validation this contract exists to provide. Each call site
 * (register/login/me on one side, org membership management on the other) already knows which
 * of the two it means, so there is no ergonomic cost to keeping them separate.
 */
export const OrganizationRoleSchema = z.enum(["owner", "manager", "operator"]);
export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

/**
 * `POST /v1/auth/register` (public — cadastro de motorista). Fields kept to the minimum
 * needed to create a `users` row and let the person log in afterwards (CLAUDE.md rule 10,
 * LGPD data minimization):
 * - `email` / `password` / `name` are required — an account needs credentials and a display
 *   name.
 * - `password` minimum length is 8 (common baseline security guidance, e.g. NIST SP 800-63B,
 *   which favors length over forced complexity rules); capped at 100 to reject pathological
 *   inputs before they reach argon2id hashing (ADR-0004) without constraining any real
 *   passphrase. This is a decision made per this task's own allowance ("não é bloqueante
 *   decidir sozinho... força mínima exata da senha") — flagged here rather than left silent.
 * - `name` minimum length 2 rejects empty/whitespace-only or single-character input while not
 *   imposing any real-name policy.
 * - `phone` is optional, matching that `users.phone` has no `not null` in the data model and
 *   register's job is only to create a login-capable account. Bounds (8-20) fit any real
 *   phone number with country code (E.164 tops out at 15 digits) plus separators/formatting
 *   the client might send before normalization, while still rejecting obvious garbage.
 * - `cpf` is intentionally NOT included: `data-model.md` lists `cpf_encrypted` on `users` but
 *   `api-and-events.md` does not require it for `/v1/auth/register`, and it is sensitive LGPD
 *   data — collecting it here would violate rule 10's minimization principle without a
 *   concrete, documented need. If a future flow needs CPF (e.g. billing/subscriptions), it
 *   should be collected in that flow's own contract, not bolted onto registration.
 */
export const RegisterInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(100),
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(8).max(20).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

/**
 * `POST /v1/auth/login` (public). No password strength check here on purpose — an existing
 * account's password was already validated at registration time (possibly under a different
 * policy over the account's lifetime); login only needs to reject an empty string before
 * hitting argon2id.
 */
export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

/**
 * ADR-0004: access token is a short-lived (15 min) JWT RS256; refresh token is a long-lived
 * (30 days) opaque, rotating token. Both fields are modeled as required non-empty strings —
 * per this task's explicit instruction, whether a given response actually includes
 * `refreshToken` on the wire (web gets it only as an HttpOnly cookie; mobile gets it in the
 * body for SecureStore) is a controller-level decision for ULTRAPLAN 1.3, not something this
 * shared shape should encode.
 */
export const TokenPairSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

/**
 * `POST /v1/auth/refresh` (public — rotação de refresh token, ULTRAPLAN 1.3). Not part of
 * the original 1.1 contract set — added now because this is the task that first needs it.
 * `refreshToken` is optional, not required, because ADR-0004 has web and mobile presenting
 * the refresh token two different ways: web never puts it in the body at all (it rides
 * along as the `HttpOnly` cookie set by `/v1/auth/login`/`/v1/auth/refresh` themselves, so
 * the browser attaches it automatically); mobile (no cookie jar tied to the app the same
 * way, SecureStore instead) sends it explicitly in the body. A single optional field lets
 * both request shapes validate against the same schema — the controller falls back to the
 * cookie when the body doesn't carry one, and treats "neither present" as an invalid token
 * (same `RefreshTokenInvalidError` as a token that doesn't exist in the database, rather
 * than a separate "missing field" `400` — no information is leaked either way).
 */
export const RefreshInputSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof RefreshInputSchema>;

/**
 * One `memberships` row as exposed to the authenticated user themselves via `GET /v1/me`:
 * `organizationId` + the `OrganizationRole` held there + `parkingLotIds`, the operator's scope
 * within that organization (`data-model.md`: "escopo do operador; vazio = todos" — an empty
 * array means unrestricted access to every lot in the organization, not "no lots").
 */
export const MembershipSchema = z.object({
  organizationId: z.uuid(),
  role: OrganizationRoleSchema,
  parkingLotIds: z.array(z.uuid()),
});
export type Membership = z.infer<typeof MembershipSchema>;

/**
 * `GET /v1/me` (autenticado): profile + memberships, per `api-and-events.md`. `roleGlobal` is
 * modeled as required-but-nullable (rather than optional) since the underlying column always
 * exists on `users` — a user simply without a platform-wide role has it as `null`, not absent.
 *
 * `name`/`phone` deliberately do NOT repeat `RegisterInputSchema`'s `trim()`/length bounds:
 * this is a read/output shape for data that already passed those rules once at write time
 * (register, or a future profile-edit contract) and now just needs to round-trip whatever the
 * database holds — re-validating input-shape rules on read data serves no purpose and would
 * only make this schema needlessly reject legitimate rows.
 */
export const MeSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  phone: z.string().optional(),
  roleGlobal: GlobalRoleSchema.nullable(),
  memberships: z.array(MembershipSchema),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * `POST /v1/orgs/:orgId/members` (ULTRAPLAN 1.5, api-and-events.md: "Convida
 * operador/gestor por e-mail (token de aceite)"). `parkingLotIds` is accepted here (mirrors
 * `MembershipSchema.parkingLotIds`'s shape) but the use case rejects any non-empty array with
 * `400 PARKING_LOT_SCOPE_UNAVAILABLE` for now — `data-model.md`'s `memberships.parking_lot_ids`
 * has no FK to `parking_lots` yet (that table doesn't exist until Phase 2) and this contract
 * can't validate "does this id belong to the inviter's own org" itself, so accepting a
 * non-empty scope here would silently persist unvalidated org-external ids (see ULTRAPLAN
 * 2.2's own prerequisite note). Kept as a field (not omitted) so the wire shape doesn't need
 * to change the day Phase 2 lifts this restriction — only the use case's check does.
 */
export const CreateInvitationInputSchema = z.object({
  email: z.email(),
  role: OrganizationRoleSchema,
  parkingLotIds: z.array(z.uuid()).default([]),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInputSchema>;

/**
 * Response of `POST /v1/orgs/:orgId/members` — the created `invitations` row, MINUS
 * `tokenHash`/the plaintext token itself (api-and-events.md: "Resposta **nunca** devolve o
 * token" — the token only ever reaches the invitee via the `identity.member_invited.v1`
 * e-mail, `MemberInvitedPayloadSchema` below).
 */
export const InvitationViewSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  email: z.email(),
  role: OrganizationRoleSchema,
  parkingLotIds: z.array(z.uuid()),
  expiresAt: z.date(),
  createdAt: z.date(),
});
export type InvitationView = z.infer<typeof InvitationViewSchema>;

/**
 * Response of `GET /v1/invitations/:token` (public — "Dados para a tela de aceite",
 * api-and-events.md) — deliberately NOT the same shape as `InvitationViewSchema`: this is a
 * read model for the accept screen (organization name, not id; whether the invited e-mail
 * already has an account, so the web client knows whether to render the "set a password"
 * fields or just a "log in to accept" button), not a projection of the `invitations` row
 * itself. `GetInvitationUseCase` returns this same generic shape for every failure mode
 * (unknown/expired/revoked/already-accepted token) too — as a `404`, never as this schema —
 * so nothing about "why" a token doesn't resolve ever needs a field here.
 */
export const InvitationPreviewSchema = z.object({
  organizationName: z.string().min(1),
  role: OrganizationRoleSchema,
  email: z.email(),
  expiresAt: z.date(),
  userExists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

/**
 * Body of `POST /v1/invitations/:token/accept` (public). Both fields are optional at the
 * schema level because the same endpoint serves two branches (api-and-events.md): the
 * invited e-mail has no `users` row yet → body carries `{ name, password }` to create one;
 * the e-mail already has an account → body is empty (`{}`), the caller is expected to log in
 * separately. Which branch applies is a fact the use case resolves against the invitation's
 * own e-mail (never something the client can plausibly know without an extra round trip
 * through `GET /v1/invitations/:token`'s `userExists` field), so "name/password required
 * when there's no existing account" is enforced by `AcceptInvitationUseCase`
 * (`INVITATION_ACCEPT_MISSING_CREDENTIALS`), not by this DTO.
 */
export const AcceptInvitationInputSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  password: z.string().min(8).max(100).optional(),
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInputSchema>;

/**
 * Payload of the `identity.member_invited.v1` domain event (api-and-events.md's event
 * table; ADR-0017 §"Consequências" explicitly calls this event out as the first one whose
 * payload carries a secret). `token` is the PLAINTEXT opaque accept token — never
 * `tokenHash` — because `notifications` (the only documented consumer) needs it to build the
 * accept URL it e-mails to the invitee; there is no other channel for the token to reach
 * them, since `InvitationViewSchema`/the HTTP response never carries it (CLAUDE.md rule 10 +
 * ADR-0017: this is exactly why the outbox/BullMQ payload must never be logged verbatim).
 * `expiresAt` is a STRING (ISO 8601), not `z.date()` like `InvitationViewSchema`'s: by the
 * time a handler reads this off `job.data`, it has round-tripped through `outbox_events`
 * (jsonb) and BullMQ (Redis, JSON-serialized) at least once — both hops serialize a `Date`
 * to its ISO string and never revive it back to a `Date` on the way out, so the wire shape a
 * real consumer observes is a string, not a `Date` instance (see
 * `DomainEventsProcessor`/`OutboxService` for where the envelope's own `occurredAt` gets the
 * same treatment explicitly).
 */
export const MemberInvitedPayloadSchema = z.object({
  invitationId: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string().min(1),
  email: z.email(),
  role: OrganizationRoleSchema,
  invitedByUserId: z.uuid(),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type MemberInvitedPayload = z.infer<typeof MemberInvitedPayloadSchema>;
