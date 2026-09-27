import { describe, expect, it } from "vitest";

import { CYCLE_STATUSES, type Cycle, type CycleStatus } from "@/lib/api/contracts";

import { CLINIC_CYCLE_BADGE, NO_CYCLE_VIEW, patientView, timeline } from "./copy";

function cycle(status: CycleStatus, extra: Partial<Cycle> = {}): Cycle {
  return {
    id: "c",
    status,
    timestamps: { requested: "2026-09-27T10:00:00Z", [status]: "2026-09-27T12:00:00Z" },
    emailStatus: null,
    pickupDeadline: null,
    declineReason: null,
    rejectReason: null,
    canRequestAgain: false,
    clinicVisitRequired: false,
    ...extra,
  };
}

const FORBIDDEN = /\b(positive|negative|confidence|reader|grok|opencv|fraud|reuse|mismatch|flag)/i;

describe("patient copy", () => {
  it("has a view for every status, and for no cycle", () => {
    for (const status of CYCLE_STATUSES) expect(patientView(cycle(status)).title).toBeTruthy();
    expect(patientView(null)).toBe(NO_CYCLE_VIEW);
  });

  it("never mentions a result, a reader or a fraud check", () => {
    const views = [
      NO_CYCLE_VIEW,
      ...CYCLE_STATUSES.map((s) => patientView(cycle(s))),
      patientView(cycle("approved", { emailStatus: "failed" })),
      patientView(cycle("approved", { emailStatus: "disabled" })),
      patientView(cycle("rejected", {})),
      patientView(cycle("declined", { canRequestAgain: true })),
    ];
    for (const v of views) expect(`${v.title} ${v.body}`).not.toMatch(FORBIDDEN);
  });

  it("gives each state its next action", () => {
    expect(NO_CYCLE_VIEW.action).toBe("request_refill");
    expect(patientView(cycle("requested")).action).toBeNull();
    // No state offers "start your test": the emailed link is the only way in.
    expect(patientView(cycle("approved", { emailStatus: "sent" })).action).toBeNull();
    expect(patientView(cycle("approved", { emailStatus: "failed" })).key).toBe("approved_email_failed");
    expect(patientView(cycle("approved", { emailStatus: "failed" })).action).toBeNull();
    expect(patientView(cycle("declined", { canRequestAgain: true })).action).toBe("request_again");
    expect(patientView(cycle("declined")).action).toBeNull();
    // A first failed test offers another go; a second in a row sends the patient in.
    expect(patientView(cycle("rejected")).action).toBe("request_again");
    expect(patientView(cycle("rejected", { clinicVisitRequired: true })).action).toBeNull();
    expect(patientView(cycle("rejected", { clinicVisitRequired: true })).key).toBe("rejected_clinic_visit");
    expect(patientView(cycle("expired", { canRequestAgain: true })).action).toBe("request_again");
    expect(patientView(cycle("in_review")).title).toBe("Submitted, your clinic will review it");
  });
});

describe("timeline", () => {
  it("marks done, current and upcoming steps", () => {
    expect(timeline(cycle("submitted")).map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  });

  it("puts an exit where it stopped", () => {
    expect(timeline(cycle("declined")).map((s) => s.state)).toEqual(["done", "exit", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(timeline(cycle("rejected"))[3]).toMatchObject({ label: "New test needed", state: "exit" });
    expect(timeline(cycle("missed"))[5]).toMatchObject({ label: "Window closed", state: "exit" });
  });

  it("shows a completed cycle as all done", () => {
    expect(timeline(cycle("picked_up")).every((s) => s.state === "done")).toBe(true);
  });
});

describe("clinic badges", () => {
  it("has a badge for every status", () => {
    for (const status of CYCLE_STATUSES) expect(CLINIC_CYCLE_BADGE[status].label).toBeTruthy();
  });
});
