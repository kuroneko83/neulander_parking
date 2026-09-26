import { describe, expect, it } from "vitest";

import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("escapes %s to %s", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it("escapes & first so it never double-encodes an already-escaped entity's ampersand", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralizes a script-injection attempt in an organization name", () => {
    const malicious = `Estacionamento <script>alert('xss')</script>`;
    const escaped = escapeHtml(malicious);

    expect(escaped).not.toContain("<script>");
    expect(escaped).toBe("Estacionamento &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("neutralizes an attribute-breakout attempt", () => {
    const malicious = `"><img src=x onerror=alert(1)>`;
    const escaped = escapeHtml(malicious);

    expect(escaped).not.toContain('">');
    expect(escaped).not.toContain("<img");
  });

  it("leaves an ordinary string with no special characters untouched", () => {
    expect(escapeHtml("Estacionamento Demo")).toBe("Estacionamento Demo");
  });

  it("handles an empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
