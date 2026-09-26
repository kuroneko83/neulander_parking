// Imported from the pure domain file directly, not `modules/shared`'s public `index.ts`
// barrel — same exception as `auth-errors.ts` (see its own comment, and the matching named
// exception in `eslint.boundaries.mjs`): that barrel also re-exports `SharedModule`
// (Nest/Drizzle/BullMQ wiring), which would eagerly evaluate `AppConfigModule` (validates
// `process.env` at import time) the moment this file is imported — breaking a pure unit
// test with no `.env` loaded (`pnpm test`, not `pnpm test:int`).
import { DomainError } from "../../shared/domain/domain-error";

/**
 * Domain errors for ULTRAPLAN 1.5 (invite/preview/accept a member). Each has a stable
 * `code` (CLAUDE.md rule: "Erros: `DomainError` com `code` estável") that the global
 * `ProblemDetailsExceptionFilter` maps straight to an RFC 9457 body.
 */

/**
 * `POST /v1/orgs/:orgId/members` — a `manager` trying to invite an `owner` (see
 * `domain/invite-policy.ts`'s `canInviteRole`). `403 Forbidden`: the caller IS authenticated
 * and a member of the org (`OrgScopeGuard` already ran), they're just not allowed to
 * escalate someone to a role they can't grant.
 */
export class InviteRoleNotAllowedError extends DomainError {
  constructor() {
    super(
      "INVITE_ROLE_NOT_ALLOWED",
      "Você não tem permissão para convidar alguém com este papel.",
      403,
    );
  }
}

/**
 * `POST /v1/orgs/:orgId/members` with a non-empty `parkingLotIds` (api-and-events.md /
 * ULTRAPLAN 1.5's own note: intentional for now, not a bug — `memberships.parking_lot_ids`
 * has no FK to `parking_lots` yet, and this endpoint has no way to validate that an id
 * belongs to the inviter's own organization before ULTRAPLAN 2.2 builds that table). `400
 * Bad Request`: the request itself is malformed relative to what this endpoint currently
 * accepts, not a business-rule violation on otherwise-valid input.
 */
export class ParkingLotScopeUnavailableError extends DomainError {
  constructor() {
    super(
      "PARKING_LOT_SCOPE_UNAVAILABLE",
      "Restringir o convite a estacionamentos específicos ainda não está disponível — convide sem parkingLotIds.",
      400,
    );
  }
}

/**
 * `POST /v1/orgs/:orgId/members` for an e-mail that already has a `users` row AND a
 * `memberships` row in the target organization. `409 Conflict` — same reasoning as
 * `EmailAlreadyRegisteredError` (auth-errors.ts): a resource ("this person is already a
 * member here") already exists.
 */
export class MemberAlreadyExistsError extends DomainError {
  constructor() {
    super("MEMBER_ALREADY_EXISTS", "Este usuário já é membro desta organização.", 409);
  }
}

/**
 * `POST /v1/orgs/:orgId/members` for an e-mail that already has a PENDING invitation in the
 * same organization (data-model.md's partial unique index: "um convite pendente por
 * e-mail/org"). `409 Conflict` — inviting the same e-mail again should revoke-then-reinvite
 * (not built yet) rather than silently create a second live token for the same e-mail/org.
 */
export class InvitationAlreadyPendingError extends DomainError {
  constructor() {
    super(
      "INVITATION_ALREADY_PENDING",
      "Já existe um convite pendente para este e-mail nesta organização.",
      409,
    );
  }
}

/**
 * `GET /v1/invitations/:token` (any failure) and `POST /v1/invitations/:token/accept`
 * (unknown token) — deliberately the SAME error for "no such token", "token belongs to a
 * revoked invitation" and "token belongs to an already-accepted invitation" on the preview
 * endpoint (ULTRAPLAN 1.5: "generic 404 for invalid/expired/consumed — don't leak which").
 * `404 Not Found`.
 */
export class InvitationNotFoundError extends DomainError {
  constructor() {
    super("INVITATION_NOT_FOUND", "Convite não encontrado.", 404);
  }
}

/**
 * `POST /v1/invitations/:token/accept` for a token that resolves to a REAL, not-yet-accepted
 * invitation whose `expires_at` has passed or that was revoked. `410 Gone` — the resource
 * (the invitation) existed and is now permanently unusable, as opposed to
 * `InvitationNotFoundError`'s "never resolves to anything at all".
 */
export class InvitationExpiredError extends DomainError {
  constructor() {
    super("INVITATION_EXPIRED", "Convite expirado ou revogado.", 410);
  }
}

/**
 * `POST /v1/invitations/:token/accept` for an invited e-mail with no existing `users` row,
 * where the body is missing `name`/`password` (`AcceptInvitationInputSchema` allows both to
 * be absent — see that schema's own comment on why the "required when creating an account"
 * rule lives here, in the use case, rather than at the DTO level). `400 Bad Request`.
 */
export class InvitationAcceptMissingCredentialsError extends DomainError {
  constructor() {
    super(
      "INVITATION_ACCEPT_MISSING_CREDENTIALS",
      "Informe nome e senha para criar sua conta.",
      400,
    );
  }
}
