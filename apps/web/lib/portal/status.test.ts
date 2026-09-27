import { describe, expect, it } from "vitest";

import { portalStatus, STATUS_TEXT, type PortalStatus, type RefillState } from "./status";

function state(over: Partial<RefillState> = {}): RefillState {
  return { request: "linked", hasTestLink: true, submission: null, window: null, ...over };
}

describe("portalStatus", () => {
  it("is pending while the clinic has not acted", () => {
    expect(portalStatus(state({ request: "requested", hasTestLink: false }))).toBe("pending");
  });

  it("is pending even if a link somehow exists but the request is untouched", () => {
    expect(portalStatus(state({ request: "requested", hasTestLink: true }))).toBe("pending");
  });

  it("is declined when staff declined, whatever else is set", () => {
    expect(portalStatus(state({ request: "declined", submission: "approved", window: "open" }))).toBe(
      "declined",
    );
  });

  it("asks for a test once a link is issued and nothing is submitted", () => {
    expect(portalStatus(state())).toBe("test_required");
    expect(portalStatus(state({ submission: "awaiting_photo" }))).toBe("test_required");
  });

  it.each(["needs_review", "ready_for_review"] as const)("is in review for %s", (submission) => {
    expect(portalStatus(state({ submission }))).toBe("in_review");
  });

  it.each(["rejected", "rejected_fraud"] as const)(
    "reports %s as not_verified, without naming the reason",
    (submission) => {
      expect(portalStatus(state({ submission }))).toBe("not_verified");
    },
  );

  it("is expired when the submission expired", () => {
    expect(portalStatus(state({ submission: "expired" }))).toBe("expired");
  });

  it("is ready for pickup once approved with an open window", () => {
    expect(portalStatus(state({ submission: "approved", window: "open" }))).toBe("ready_for_pickup");
  });

  it("is ready for pickup when approved before a window row exists yet", () => {
    expect(portalStatus(state({ submission: "approved", window: null }))).toBe("ready_for_pickup");
  });

  it("prefers the furthest point reached: a filled window beats an approved submission", () => {
    expect(portalStatus(state({ submission: "approved", window: "filled" }))).toBe("picked_up");
  });

  it("reports a missed window rather than still inviting a pickup", () => {
    expect(portalStatus(state({ submission: "approved", window: "missed" }))).toBe("window_missed");
  });

  it("a patient asking cannot move themselves past pending", () => {
    // The only field a patient controls is the existence of the request itself.
    const asked = portalStatus(state({ request: "requested", hasTestLink: false }));
    expect(asked).toBe("pending");
  });
});

describe("STATUS_TEXT", () => {
  const all: PortalStatus[] = [
    "pending",
    "declined",
    "test_required",
    "in_review",
    "not_verified",
    "ready_for_pickup",
    "picked_up",
    "window_missed",
    "expired",
  ];

  it("has wording for every status", () => {
    for (const s of all) {
      expect(STATUS_TEXT[s]?.label, s).toBeTruthy();
      expect(STATUS_TEXT[s]?.detail, s).toBeTruthy();
    }
  });

  it("never tells a patient a fraud check was the reason", () => {
    const words = Object.values(STATUS_TEXT)
      .map((t) => `${t.label} ${t.detail}`.toLowerCase())
      .join(" ");
    for (const leak of ["fraud", "fake", "reuse", "hash", "code"]) {
      expect(words, leak).not.toContain(leak);
    }
  });
});
