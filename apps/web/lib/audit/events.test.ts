import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS, isAuditAction } from "./events";

describe("audit event catalog", () => {
  it("contains every action the app writes", () => {
    for (const action of [
      "request.issued",
      "request.emailed",
      "session.started",
      "submission.received",
      "submission.rejected_link",
      "submission.rejected_fraud",
      "review.approved",
      "review.rejected",
      "window.filled",
      "window.missed",
      "patient.home_testing_changed",
    ]) {
      expect(isAuditAction(action)).toBe(true);
    }
  });

  it("has no duplicates and no anchor event", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(AUDIT_ACTIONS.some((a) => a.startsWith("anchor"))).toBe(false);
  });

  it("rejects unknown values", () => {
    expect(isAuditAction("submission.deleted")).toBe(false);
    expect(isAuditAction(42)).toBe(false);
  });
});
