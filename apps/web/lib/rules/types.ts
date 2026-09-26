// Shared types for the PledgeCheck rules engine.
// Owner: Labib (ticket L3)

export type Phase = "pre" | "during" | "after" | "complete";
export type Setting = "home" | "clinic";
export type Decision = "ready_for_review" | "needs_review" | "blocked";
export type TestResult = "positive" | "negative" | "invalid";
export type Language = "en" | "es";
export type WindowStatus = "open" | "filled" | "missed";

/** The window a prescription must be picked up in. */
export interface TestWindow {
  isFirstRx: boolean;
  opensAt: string;
  closesAt: string;
  filledAt?: string | null;
  status: WindowStatus;
}

/** Patient state the engine needs. Never carries a name, DOB or SSN. */
export interface Patient {
  id: string;
  canGetPregnant: boolean;
  homeTestingAllowed: boolean;
  phase: Phase;
  /** ISO date the course starts, or null if not scheduled yet. */
  treatmentStart: string | null;
  language: Language;
  /** Most recent window for this patient, if the course has already begun. */
  lastWindow?: TestWindow | null;
}

/** The submission under evaluation, after the fraud checks have run. */
export interface Submission {
  id: string;
  /** Where the test was taken, from the test_request the link was issued for. */
  setting: Setting;
  /** True when this submission gates the first prescription of the course. */
  isFirstRx: boolean;
  /** Server-stamped capture time (ISO). */
  capturedAt: string;
  /** The 4-character code the clinic put in the link. */
  challengeCode: string;
  /** Fraud flags raised upstream, e.g. ["photo_already_used"]. */
  flags: string[];
}

/** One independent read of the photo. */
export interface Read {
  source: "grok" | "cv";
  result: TestResult;
  confidence: number;
  /** The code the reader saw written on the test. Grok only; null for OpenCV. */
  codeRead?: string | null;
}

export interface Evaluation {
  decision: Decision;
  reasons: string[];
  /** Proposed window, present only when a prescriber could approve this. */
  window: { opensAt: string; closesAt: string } | null;
}
