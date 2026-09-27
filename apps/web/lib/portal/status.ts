// What a patient sees about one refill request. Owner: Labib.
//
// Pure and derived: this reads the state the clinic already produced and translates it
// into one word for the patient. It stores nothing and decides nothing. Every transition
// below is caused by a clinician acting - issuing a link, approving, rejecting, marking
// filled - or by time passing. A patient asking for a refill moves them no further than
// `pending`.
//
// Derived rather than stored on purpose: refill_requests keeps no copy of the test
// outcome, so there is one source of truth (submissions -> reviews -> windows) and
// nothing here can drift out of step with what the clinic actually decided.

/** Submission statuses, from db/schema.sql. */
export type SubmissionStatus =
  | "awaiting_photo"
  | "rejected_fraud"
  | "needs_review"
  | "ready_for_review"
  | "approved"
  | "rejected"
  | "expired";

export type WindowStatus = "open" | "filled" | "missed";

export type RefillState = {
  /** The row's own status: what staff decided about the request itself. */
  request: "requested" | "linked" | "declined";
  /** Set once staff issued a test link for this request. */
  hasTestLink: boolean;
  /** The submission made against that link, if the patient has taken the test. */
  submission: SubmissionStatus | null;
  /** The pickup window, if the submission was approved. */
  window: WindowStatus | null;
};

export type PortalStatus =
  | "pending"
  | "declined"
  | "test_required"
  | "in_review"
  | "not_verified"
  | "ready_for_pickup"
  | "picked_up"
  | "window_missed"
  | "expired";

/**
 * One patient-facing status for a refill request.
 *
 * Order matters: the furthest point reached wins, so a window that has been filled
 * reports `picked_up` even though the submission behind it is still `approved`.
 */
export function portalStatus(state: RefillState): PortalStatus {
  if (state.request === "declined") return "declined";
  if (state.request === "requested" || !state.hasTestLink) return "pending";

  // A link exists but nothing has been submitted against it yet.
  if (state.submission === null || state.submission === "awaiting_photo") return "test_required";

  switch (state.submission) {
    case "needs_review":
    case "ready_for_review":
      return "in_review";
    // Two different failures, one patient-facing word. The distinction between a fraud
    // rejection and a clinical rejection is the clinic's to explain in person, not
    // something to spell out on a status page.
    case "rejected":
    case "rejected_fraud":
      return "not_verified";
    case "expired":
      return "expired";
    case "approved":
      break;
  }

  // Approved: the window decides how far along the patient actually is.
  if (state.window === "filled") return "picked_up";
  if (state.window === "missed") return "window_missed";
  return "ready_for_pickup";
}

/** Wording shown to the patient. Plain, and never implies the patient can act on a decision. */
export const STATUS_TEXT: Record<PortalStatus, { label: string; detail: string }> = {
  pending: {
    label: "Pending",
    detail: "Your clinic has your request and will review it.",
  },
  declined: {
    label: "Declined",
    detail: "Your clinic did not approve this request. They will be in touch.",
  },
  test_required: {
    label: "Test required",
    detail: "Your clinic sent a test link to your email. Open it to take your test.",
  },
  in_review: {
    label: "In review",
    detail: "Your test was received. Your prescriber is reviewing it.",
  },
  not_verified: {
    label: "Not verified",
    detail: "Your test could not be verified. Your clinic will contact you about next steps.",
  },
  ready_for_pickup: {
    label: "Ready to pick up",
    detail: "Approved. Your prescription is ready to collect from your pharmacy.",
  },
  picked_up: {
    label: "Picked up",
    detail: "This prescription has been collected.",
  },
  window_missed: {
    label: "Pickup window closed",
    detail: "The pickup window closed. Contact your clinic to arrange a repeat test.",
  },
  expired: {
    label: "Expired",
    detail: "This request expired before a test was completed. You can request a new refill.",
  },
};
