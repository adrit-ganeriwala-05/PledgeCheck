import { describe, expect, it } from "vitest";

import { CYCLE_STATUSES } from "@/lib/api/contracts";
import { BLOCKING_STATUSES, cycleStatusFor, toCycle, type CycleSource } from "@/lib/portal/cycle";
import { portalStatus, STATUS_TEXT, type PortalStatus } from "@/lib/portal/status";

const BASE: CycleSource = {
  id: "c1",
  status: "pending",
  createdAt: "2026-09-27T10:00:00Z",
  decidedAt: null,
  declineReason: null,
  capturedAt: null,
  reviewReason: null,
  reviewedAt: null,
  windowOpensAt: null,
  windowClosesAt: null,
  windowFilledAt: null,
  linkExpiresAt: null,
};

const ALL_PORTAL_STATUSES = Object.keys(STATUS_TEXT) as PortalStatus[];

describe("cycleStatusFor", () => {
  it("maps every backend status onto a status the screens know", () => {
    for (const status of ALL_PORTAL_STATUSES) {
      expect(CYCLE_STATUSES).toContain(cycleStatusFor(status));
    }
  });

  it("is total: no backend status falls through to undefined", () => {
    expect(ALL_PORTAL_STATUSES.map(cycleStatusFor).filter(Boolean)).toHaveLength(ALL_PORTAL_STATUSES.length);
  });

  it("collapses nothing the patient must tell apart", () => {
    // Two distinct backend states must not land on one screen state, or the timeline
    // would show the same step for different situations.
    const mapped = ALL_PORTAL_STATUSES.map(cycleStatusFor);
    expect(new Set(mapped).size).toBe(ALL_PORTAL_STATUSES.length);
  });
});

describe("toCycle", () => {
  it("carries the decision time to `approved` on the happy path", () => {
    const cycle = toCycle({ ...BASE, status: "test_required", decidedAt: "2026-09-27T11:00:00Z" });
    expect(cycle.status).toBe("approved");
    expect(cycle.timestamps).toEqual({ requested: BASE.createdAt, approved: "2026-09-27T11:00:00Z" });
  });

  it("carries the same decision time to `declined` on the refusal", () => {
    const cycle = toCycle({ ...BASE, status: "declined", decidedAt: "2026-09-27T11:00:00Z", declineReason: "Book a visit" });
    expect(cycle.status).toBe("declined");
    expect(cycle.timestamps.declined).toBe("2026-09-27T11:00:00Z");
    expect(cycle.timestamps.approved).toBeUndefined();
    expect(cycle.declineReason).toBe("Book a visit");
  });

  it("reports the pickup deadline from the window, open or closed", () => {
    const window = { windowOpensAt: "2026-09-28T00:00:00Z", windowClosesAt: "2026-10-05T00:00:00Z" };
    expect(toCycle({ ...BASE, status: "ready_for_pickup", ...window }).pickupDeadline).toBe("2026-10-05T00:00:00Z");
    expect(toCycle({ ...BASE, status: "window_missed", ...window }).pickupDeadline).toBe("2026-10-05T00:00:00Z");
  });

  it("stamps `missed` only once the window actually missed", () => {
    const window = { windowOpensAt: "2026-09-28T00:00:00Z", windowClosesAt: "2026-10-05T00:00:00Z" };
    expect(toCycle({ ...BASE, status: "ready_for_pickup", ...window }).timestamps.missed).toBeUndefined();
    expect(toCycle({ ...BASE, status: "window_missed", ...window }).timestamps.missed).toBe("2026-10-05T00:00:00Z");
  });

  it("never claims to know whether the email went out", () => {
    // refill_requests stores no email outcome, so a cycle read back cannot invent one.
    for (const status of ALL_PORTAL_STATUSES) {
      expect(toCycle({ ...BASE, status }).emailStatus).toBeNull();
    }
  });

  it("blocks a second request only while the first is still pending", () => {
    // POST /api/portal/refills refuses on status = 'requested' and nothing else, so
    // anything wider here would tell the patient no where the server would say yes.
    expect(BLOCKING_STATUSES).toEqual(["requested"]);
    expect(toCycle({ ...BASE, status: "pending" }).canRequestAgain).toBe(false);
    for (const status of ALL_PORTAL_STATUSES.filter((s) => s !== "pending")) {
      expect(toCycle({ ...BASE, status }).canRequestAgain).toBe(true);
    }
  });

  it("agrees with the backend's own derivation, end to end", () => {
    // The status a patient sees comes from portalStatus, not from anything decided here.
    const derived = portalStatus({ request: "linked", hasTestLink: true, submission: "approved", window: "filled" });
    expect(toCycle({ ...BASE, status: derived }).status).toBe("picked_up");
  });

  it("passes the prescriber's note through on a rejection only", () => {
    const rejected = toCycle({ ...BASE, status: "not_verified", reviewReason: "Photo too dark", reviewedAt: "2026-09-28T09:00:00Z" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("Photo too dark");
    expect(rejected.timestamps.rejected).toBe("2026-09-28T09:00:00Z");
  });
});
