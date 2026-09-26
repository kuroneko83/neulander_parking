import type { OrganizationRole } from "@neulander/contracts";

// Imported from the pure domain file directly, not `modules/shared`'s public `index.ts`
// barrel — same exception as `modules/identity/domain/auth-errors.ts`/`invitation-errors.ts`
// (see either's own comment, and the matching named exception in `eslint.boundaries.mjs`):
// that barrel also re-exports `SharedModule` (Nest/Drizzle/BullMQ wiring), which eagerly
// evaluates `AppConfigModule`/`DatabaseModule` (validate `process.env`/open a DB pool at
// import time) the moment this file is imported — breaking `member-invite.test.ts`, a pure
// unit test with no `.env` loaded (`pnpm test`, not `pnpm test:int`).
import { escapeHtml } from "../../../shared/domain/escape-html";

/**
 * Pure e-mail-content template for `identity.member_invited.v1` (ULTRAPLAN 1.5). No
 * template engine (Handlebars/MJML/etc.) — a single small function returning plain strings
 * is enough for one e-mail with three variables, and it's trivially unit-testable without
 * touching the filesystem or a rendering runtime.
 *
 * pt-BR copy (CLAUDE.md: "UI, docs e mensagens ao usuário em pt-BR"). `role` is rendered as
 * its pt-BR label (glossary.md: Proprietário/Gestor/Operador) rather than the raw enum value
 * — an invitee reading "papel: manager" would have no idea what that means.
 *
 * `organizationName` is HTML-escaped (`escapeHtml`, `shared/domain/`) before it's
 * interpolated into `html` below (security-review fix) — it's free-form text a
 * `platform_admin` sets via `POST /v1/orgs`, string-concatenated straight into markup
 * otherwise. `text` never needed escaping (plain text has no markup to break out of); `role`
 * doesn't either (`ROLE_LABELS` below is a fixed, hardcoded lookup table, never
 * user-supplied).
 */

const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Proprietário",
  manager: "Gestor",
  operator: "Operador",
};

export interface MemberInviteTemplateInput {
  organizationName: string;
  role: OrganizationRole;
  /** Full URL the invitee clicks to land on the web app's accept-invite screen — already
   * built (host + path + token) by the caller (`notifications/events`'s own handler),
   * never assembled in here (this file has no notion of `WEB_APP_URL`). */
  acceptUrl: string;
  expiresAt: Date;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** `pt-BR`, matching the rest of the codebase's date formatting choices (no i18n library
 * pulled in for one date in one e-mail template). */
function formatExpiresAt(expiresAt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(expiresAt);
}

export function renderMemberInviteEmail(input: MemberInviteTemplateInput): RenderedEmail {
  const roleLabel = ROLE_LABELS[input.role];
  const expiresAtLabel = formatExpiresAt(input.expiresAt);
  const escapedOrganizationName = escapeHtml(input.organizationName);

  const subject = `Convite para ${input.organizationName} — Neulander Parking`;

  const text = [
    `Você foi convidado para participar de "${input.organizationName}" como ${roleLabel} no Neulander Parking.`,
    "",
    `Aceite o convite acessando: ${input.acceptUrl}`,
    "",
    `Este convite expira em ${expiresAtLabel}.`,
    "",
    "Se você não esperava este convite, pode ignorar este e-mail.",
  ].join("\n");

  const html = [
    `<p>Você foi convidado para participar de <strong>${escapedOrganizationName}</strong> como <strong>${roleLabel}</strong> no Neulander Parking.</p>`,
    `<p><a href="${input.acceptUrl}">Aceitar convite</a></p>`,
    `<p>Este convite expira em ${expiresAtLabel}.</p>`,
    "<p>Se você não esperava este convite, pode ignorar este e-mail.</p>",
  ].join("\n");

  return { subject, text, html };
}
