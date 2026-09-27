import { describe, expect, it } from "vitest";

import { clinicVisitRequired, consecutiveFailedTests, HOME_TEST_ATTEMPTS } from "./attempts";
import type { PortalStatus } from "./status";

/** Requests newest first, the order the portal and the refill route both read them in. */
function run(...newestFirst: PortalStatus[]) {
  return consecutiveFailedTests(newestFirst);
}

describe("consecutiveFailedTests", () => {
  it("is zero for a patient with no history and for one who never failed", () => {
    expect(run()).toBe(0);
    expect(run("pending")).toBe(0);
    expect(run("ready_for_pickup", "picked_up")).toBe(0);
  });

  it("counts a run of failures", () => {
    expect(run("not_verified")).toBe(1);
    expect(run("not_verified", "not_verified")).toBe(2);
    expect(run("not_verified", "not_verified", "not_verified")).toBe(3);
  });

  it("stops at a verified test, so a good month resets the run", () => {
    expect(run("not_verified", "picked_up", "not_verified")).toBe(1);
    expect(run("not_verified", "ready_for_pickup", "not_verified", "not_verified")).toBe(1);
    // The test passed and a window opened; missing the pickup is a different problem.
    expect(run("not_verified", "window_missed", "not_verified")).toBe(1);
  });

  it("counts past states where no test was ever read", () => {
    // A decline, an expired link or a request still in flight is not a failure, and it is not
    // a clean test either, so it neither counts nor clears what came before it.
    expect(run("pending", "not_verified")).toBe(1);
    expect(run("not_verified", "declined", "not_verified")).toBe(2);
    expect(run("not_verified", "expired", "not_verified")).toBe(2);
    expect(run("not_verified", "in_review", "not_verified")).toBe(2);
    expect(run("not_verified", "test_required", "not_verified")).toBe(2);
  });
});

describe("clinicVisitRequired", () => {
  it("allows one retry at home and sends the patient in after the second failure", () => {
    expect(HOME_TEST_ATTEMPTS).toBe(2);
    expect(clinicVisitRequired(0)).toBe(false);
    expect(clinicVisitRequired(1)).toBe(false);
    expect(clinicVisitRequired(2)).toBe(true);
    expect(clinicVisitRequired(3)).toBe(true);
  });
});
