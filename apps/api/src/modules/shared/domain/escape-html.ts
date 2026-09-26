/**
 * Escapes the five characters that matter for safely interpolating an arbitrary string into
 * HTML markup (security-review fix, ULTRAPLAN 1.5 — `notifications/domain/templates/
 * member-invite.ts` string-concatenates `organizationName` directly into an e-mail's `html`
 * body; today only a `platform_admin` can set an organization's name (`POST /v1/orgs`), so
 * impact is limited, but nothing enforces that staying true forever). Lives in `shared/
 * domain/` (not `notifications/domain/`) — Phase 5's daily-report e-mails
 * (`docs/ULTRAPLAN.md` 5.11/5.14) interpolate lot/organization names into HTML too, so this
 * is deliberately a reusable, one-off pure function from the start, not a
 * `notifications`-only helper duplicated later.
 *
 * Not a general-purpose HTML sanitizer — it only escapes text meant to appear between tags/
 * in an attribute VALUE (which is exactly how every call site today uses it); it does not
 * attempt to validate/sanitize a value used as a tag name, attribute name, or inside a
 * `<script>`/`<style>` block.
 */
export function escapeHtml(rawValue: string): string {
  return rawValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
