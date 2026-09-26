import { beforeEach, describe, expect, it, vi } from "vitest";

import * as audit from "./audit";
import { IntegrationUnavailableError } from "./errors";
import * as window from "./window";

// openApprovalWindow asks the database how many windows this patient already has.
// Only that count matters here; the dates come from the rules engine.
const db = vi.hoisted(() => ({ count: 0, error: null as { message: string } | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ count: db.count, error: db.error }),
      }),
    }),
  }),
}));

const APPROVED_AT = "2026-09-26T15:00:00.000Z";

const input = {
  patientId: "11000000-0000-0000-0000-000000000001",
  submissionId: "13000000-0000-0000-0000-000000000001",
  approvedAt: APPROVED_AT,
};

describe("window adapter (Labib's rules engine)", () => {
  beforeEach(() => {
    db.count = 0;
    db.error = null;
  });

  it("opens a 7-day window at the moment of approval", async () => {
    const result = await window.openApprovalWindow(input);

    expect(result.opensAt).toBe(APPROVED_AT);
    expect(result.closesAt).toBe("2026-10-03T15:00:00.000Z");
  });

  it("calls it the first prescription when the patient has no earlier window", async () => {
    await expect(window.openApprovalWindow(input)).resolves.toMatchObject({ isFirstRx: true });
  });

  it("is not the first prescription once a window exists", async () => {
    db.count = 1;
    await expect(window.openApprovalWindow(input)).resolves.toMatchObject({ isFirstRx: false });
  });

  it("refuses an approvedAt that is not a date", async () => {
    await expect(window.openApprovalWindow({ ...input, approvedAt: "soon" })).rejects.toThrow(
      /not a date/,
    );
  });

  it("fails loudly rather than guessing when the count cannot be read", async () => {
    db.error = { message: "connection lost" };
    await expect(window.openApprovalWindow(input)).rejects.toThrow(/could not count/);
  });
});

describe("integration adapters (teammate modules not present yet)", () => {
  it("audit adapter reports it is unavailable", async () => {
    const call = audit.append({ actor: "clinician:x", action: "review.approved", refId: null, payload: {} });
    await expect(call).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(call).rejects.toMatchObject({ integration: "audit" });
  });
});
