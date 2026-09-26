// PledgeCheck rules engine. Owner: Labib (ticket L3).
//
// Pure and deterministic: the same inputs always give the same decision, and
// nothing here reads the clock, the network or the database. AI output is one
// input among several, never the decision.
//
// Rules encoded, with where each one comes from (PRD v2, "Rules to encode"):
//   1. First, pre-treatment test must be in a medical setting.   FDA bulletin
//   2. Home tests only if the prescriber permits it.             Confirmed
//   3. Guard against misread and faked tests.                    Method is ours
//   4. First Rx picked up within 7 days; missed window means a
//      repeat test in a medical setting, no waiting period.      Dermatology NP/PA
//   5. Patients who cannot get pregnant skip the test loop.      Drugs.com
//   6. Anything uncertain goes to a human; never auto-approve.   Our design rule
//
// TODO (Sat 9 AM standup): confirm rules 1, 2, 4 and 5 line by line against the
// official iPLEDGE prescriber guide before this ships.

import type {
  Decision,
  Evaluation,
  Patient,
  Read,
  Submission,
  TestResult,
} from "./types";

/** Both readers must reach at least this confidence to skip manual review. */
export const CONFIDENCE_THRESHOLD = 0.85;

/** A verified test opens a 7-day window to pick the prescription up. */
export const WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Window that a verification at `now` would open. */
export function windowFor(now: Date): { opensAt: string; closesAt: string } {
  return {
    opensAt: now.toISOString(),
    closesAt: new Date(now.getTime() + WINDOW_DAYS * DAY_MS).toISOString(),
  };
}

/**
 * Decide what happens to one submission.
 *
 * `blocked` never reaches a prescriber; `needs_review` and `ready_for_review`
 * both do, the first one flagged for a closer look.
 */
export function evaluate(
  patient: Patient,
  submission: Submission,
  reads: Read[],
  now: Date,
): Evaluation {
  const blocked: string[] = [];
  const review: string[] = [];
  const ok: string[] = [];

  const isHome = submission.setting === "home";

  // Rule 5 — patients who cannot get pregnant never enter the test loop.
  if (!patient.canGetPregnant) {
    blocked.push(
      "patient cannot get pregnant; no pregnancy testing required, counseling recorded at enrollment",
    );
    return decide(blocked, review, ok, null);
  }

  // Fraud checks that already failed upstream stop here.
  if (submission.flags.length > 0) {
    for (const flag of submission.flags) blocked.push(`fraud check failed: ${flag}`);
  }

  // Rule 2 — home tests only for patients the prescriber has allowed.
  if (isHome && !patient.homeTestingAllowed) {
    blocked.push("home testing not permitted for this patient");
  }

  // Rule 1 — the first, pre-treatment test must be in a medical setting.
  if (isHome && !treatmentHasStarted(patient, submission, now)) {
    blocked.push("first pre-treatment test must be taken in a medical setting");
  }

  // Rule 4 — a missed first-Rx window needs a repeat test in a medical setting.
  // The 19-day lockout is gone, so a clinic test is accepted immediately.
  if (isHome && missedFirstRxWindow(patient, now)) {
    blocked.push(
      "first prescription window was missed; repeat test must be in a medical setting",
    );
  }

  if (blocked.length > 0) return decide(blocked, review, ok, null);

  // Rule 3 and 6 — two independent readers must agree, confidently.
  const grok = reads.find((r) => r.source === "grok");
  const cv = reads.find((r) => r.source === "cv");

  if (!grok || !cv) {
    review.push("only one reader returned a result");
  } else {
    if (grok.result !== cv.result) {
      review.push(`readers disagree: Grok read ${grok.result}, OpenCV read ${cv.result}`);
    } else {
      ok.push(`readers agree: ${grok.result}`);
    }

    const weak = [grok, cv].filter((r) => r.confidence < CONFIDENCE_THRESHOLD);
    for (const r of weak) {
      review.push(
        `${label(r.source)} confidence ${r.confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}`,
      );
    }
    if (weak.length === 0) ok.push("both readers above the confidence threshold");
  }

  // The challenge code proves the photo was taken after the link was issued.
  // A missing or wrong code is a fraud failure, not a judgment call.
  // Reasons are stored and audited, so they never include either code.
  if (grok) {
    const expected = normalizeCode(submission.challengeCode);
    const read = normalizeCode(grok.codeRead ?? "");
    if (read === "") {
      blocked.push("code missing or wrong: no code visible on the test");
      return decide(blocked, review, ok, null);
    }
    if (read !== expected) {
      blocked.push("code missing or wrong: the code on the test does not match");
      return decide(blocked, review, ok, null);
    }
    ok.push("code matches");
  }

  // A positive or unreadable test is never a routine approval.
  const result = agreedResult(grok, cv);
  if (result === "positive") {
    review.push("positive result; prescriber must contact the patient before any fill");
  } else if (result === "invalid") {
    review.push("test reads invalid; a new test is likely needed");
  }

  return decide(blocked, review, ok, windowFor(now));
}

/** Case and spacing never matter: "k7 q2" is K7Q2 (same rule as lib/fraud codesMatch). */
function normalizeCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

function label(source: Read["source"]): string {
  return source === "grok" ? "Grok" : "OpenCV";
}

/** The agreed result, or null when the readers disagree or one is missing. */
function agreedResult(grok?: Read, cv?: Read): TestResult | null {
  if (!grok || !cv) return grok?.result ?? cv?.result ?? null;
  return grok.result === cv.result ? grok.result : null;
}

/**
 * True once the course has begun. A home test is only allowed after the first,
 * in-clinic test, so a patient still in the `pre` phase, or whose start date is
 * in the future, cannot submit from home.
 */
function treatmentHasStarted(patient: Patient, submission: Submission, now: Date): boolean {
  if (patient.phase === "pre") return false;
  if (submission.isFirstRx) return false;
  if (!patient.treatmentStart) return false;
  return new Date(patient.treatmentStart).getTime() <= now.getTime();
}

/** True when the patient's first-prescription window closed without a fill. */
function missedFirstRxWindow(patient: Patient, now: Date): boolean {
  const w = patient.lastWindow;
  if (!w || !w.isFirstRx) return false;
  if (w.status === "missed") return true;
  if (w.status === "filled" || w.filledAt) return false;
  return new Date(w.closesAt).getTime() < now.getTime();
}

function decide(
  blocked: string[],
  review: string[],
  ok: string[],
  window: { opensAt: string; closesAt: string } | null,
): Evaluation {
  let decision: Decision;
  let reasons: string[];

  if (blocked.length > 0) {
    decision = "blocked";
    reasons = blocked;
  } else if (review.length > 0) {
    decision = "needs_review";
    reasons = review;
  } else {
    decision = "ready_for_review";
    reasons = ok;
  }

  return { decision, reasons, window: decision === "blocked" ? null : window };
}
