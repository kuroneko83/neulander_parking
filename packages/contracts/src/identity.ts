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
