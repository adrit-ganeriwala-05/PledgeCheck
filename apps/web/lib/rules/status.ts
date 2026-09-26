// Mapping from an engine decision to the submission status column.
// Owner: Labib (L4). Shared with the review queue (A5) so both agree.

import type { Evaluation } from "./types";

export type SubmissionStatus =
  | "awaiting_photo"
  | "rejected_fraud"
  | "needs_review"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "expired";

/** Reasons that come from a fraud check rather than a clinical rule. */
const FRAUD_MARKERS = ["fraud check failed", "code missing or wrong"];

export function isFraudReason(reason: string): boolean {
  return FRAUD_MARKERS.some((marker) => reason.includes(marker));
}

/**
 * A blocked submission never reaches the prescriber's queue. It is either a
 * fraud failure (the patient retakes with a new link) or a clinical rule that
 * sends them to the clinic, which the practice follows up in person.
 */
export function statusFor(evaluation: Evaluation): SubmissionStatus {
  if (evaluation.decision === "blocked") {
    return evaluation.reasons.some(isFraudReason) ? "rejected_fraud" : "rejected";
  }
  return evaluation.decision;
}
