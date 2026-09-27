// How many home tests a patient gets before the clinic has to see them. Owner: Labib.
//
// One failed test is not a reason to send someone in: a photo can be blurry, a code can be
// written in the wrong place, a test can genuinely need retaking. Two failures in a row is a
// different signal, and the clinic should look at the patient rather than at another photo.
//
// Pure and derived, like lib/portal/status.ts: nothing is stored, so there is no counter to
// drift out of step with the tests that actually happened. The count is read back from the
// patient's own refill history every time it is needed.

import type { PortalStatus } from "./status";

/** Home tests allowed per run of failures. The next one is in the clinic. */
export const HOME_TEST_ATTEMPTS = 2;

/**
 * Statuses that mean a prescriber verified a test, so the run of failures is over.
 *
 * window_missed belongs here: the test passed and a window opened; missing the pickup is a
 * separate problem with its own wording, and it does not make the earlier test a failure.
 */
const VERIFIED: readonly PortalStatus[] = ["ready_for_pickup", "picked_up", "window_missed"];

/**
 * Failed tests in the current run, given the patient's requests newest first.
 *
 * Counts back from the newest and stops at a verified test, so a good month always resets
 * the run. A decline or an expired link is neither a failure nor a reset: no test was read,
 * so it is skipped and counting continues past it.
 */
export function consecutiveFailedTests(newestFirst: readonly PortalStatus[]): number {
  let failures = 0;
  for (const status of newestFirst) {
    if (status === "not_verified") {
      failures += 1;
      continue;
    }
    if (VERIFIED.includes(status)) break;
  }
  return failures;
}

/** True once the patient has used every home attempt and has to be seen in person. */
export function clinicVisitRequired(failedTests: number): boolean {
  return failedTests >= HOME_TEST_ATTEMPTS;
}
