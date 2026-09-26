import { describe, expect, it } from "vitest";

import { renderMemberInviteEmail } from "./member-invite";

function validInput() {
  return {
    organizationName: "Estacionamento Demo",
    role: "manager" as const,
    acceptUrl: "http://localhost:5173/accept-invite/a-opaque-token",
    expiresAt: new Date("2026-10-03T15:00:00.000Z"),
  };
}

describe("renderMemberInviteEmail", () => {
  it("includes the organization name, the pt-BR role label and the accept URL in both text and html", () => {
    const email = renderMemberInviteEmail(validInput());

    expect(email.subject).toContain("Estacionamento Demo");
    expect(email.text).toContain("Estacionamento Demo");
    expect(email.text).toContain("Gestor");
    expect(email.text).toContain("http://localhost:5173/accept-invite/a-opaque-token");
    expect(email.html).toContain("Estacionamento Demo");
    expect(email.html).toContain("Gestor");
    expect(email.html).toContain('href="http://localhost:5173/accept-invite/a-opaque-token"');
  });

  it.each([
    ["owner", "Proprietário"],
    ["manager", "Gestor"],
    ["operator", "Operador"],
  ] as const)("renders the pt-BR label for role %s (%s)", (role, label) => {
    const email = renderMemberInviteEmail({ ...validInput(), role });

    expect(email.text).toContain(label);
    expect(email.html).toContain(label);
  });

  it("formats expiresAt as a human-readable pt-BR date/time, not the raw ISO string", () => {
    const email = renderMemberInviteEmail(validInput());

    expect(email.text).not.toContain("2026-10-03T15:00:00.000Z");
    expect(email.html).not.toContain("2026-10-03T15:00:00.000Z");
  });

  it("returns a non-empty subject/text/html for every call", () => {
    const email = renderMemberInviteEmail(validInput());

    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
  });

  it("HTML-escapes a malicious organizationName in html, but leaves text untouched (security-review fix)", () => {
    const malicious = `Estacionamento <script>alert('xss')</script>`;
    const email = renderMemberInviteEmail({ ...validInput(), organizationName: malicious });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    // Plain text has no markup to break out of — the raw name is fine there.
    expect(email.text).toContain(malicious);
  });
});
