import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path";
import { can, clinicLinksFor, ROLE_HOME } from "./permissions";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/portal")).toBe("/portal");
    expect(safeNextPath("/portal?tab=1#top")).toBe("/portal?tab=1#top");
  });

  it.each([
    "https://evil.test/portal",
    "http://evil.test",
    "//evil.test",
    "//evil.test/portal",
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "portal",
    "/portal\nSet-Cookie:x",
    "",
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/portal");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath(null, "/x")).toBe("/x");
  });
});

describe("permissions", () => {
  it("only prescribers review results", () => {
    expect(can("prescriber", "results.review")).toBe(true);
    expect(can("staff", "results.review")).toBe(false);
    expect(can(null, "requests.review")).toBe(false);
  });

  it("staff see Requests, Patients, Windows and Audit; prescribers also see Queue", () => {
    expect(clinicLinksFor("staff").map((l) => l.label)).toEqual(["Requests", "Patients", "Windows", "Audit"]);
    expect(clinicLinksFor("prescriber").map((l) => l.label)).toEqual(["Requests", "Patients", "Queue", "Windows", "Audit"]);
  });

  it("sends each role to its home screen", () => {
    expect(ROLE_HOME).toEqual({ prescriber: "/queue", staff: "/requests" });
  });
});
