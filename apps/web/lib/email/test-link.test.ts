import { describe, expect, it } from "vitest";

import { testLinkEmail } from "./test-link";

const LINK = "https://pledgecheck.tech/t/abcDEF123_-abcDEF123_-abcDEF123_-abcDEF1";
const EXPIRES = "2026-09-28T15:00:00Z";

describe("testLinkEmail", () => {
  it("puts the link in both bodies and addresses the patient", () => {
    const message = testLinkEmail({ to: "p@example.com", link: LINK, expiresAt: EXPIRES });
    expect(message.to).toBe("p@example.com");
    expect(message.subject).toBe("Your PledgeCheck link");
    expect(message.text).toContain(LINK);
    expect(message.html).toContain(`href="${LINK}"`);
    expect(message.text).toMatch(/expires Sep 28, 2026/);
  });

  it("escapes the link in HTML", () => {
    const message = testLinkEmail({
      to: "p@example.com",
      link: `https://x.test/t/"><script>`,
      expiresAt: EXPIRES,
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("writes Spanish copy for Spanish-speaking patients", () => {
    const message = testLinkEmail({ to: "p@example.com", link: LINK, expiresAt: EXPIRES, language: "es" });
    expect(message.subject).toBe("Su enlace de PledgeCheck");
    expect(message.text).toContain("Comenzar");
  });

  it.each(["en", "es"] as const)("keeps the %s subject neutral for lock screens", (language) => {
    const { subject } = testLinkEmail({ to: "p@example.com", link: LINK, expiresAt: EXPIRES, language });
    expect(subject).not.toMatch(/pregnan|embaraz|test|prueba/i);
  });
});
