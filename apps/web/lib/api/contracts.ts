// Request and response types for every endpoint the browser calls. Screens import types from
// here and call endpoints through ./client, never fetch directly. notes/v3-api-contracts.md is
// the human-readable copy of this file for the backend team.

import type { QueueCard } from "@/lib/clinic/queue";

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Errors any endpoint can produce, on top of its own. */
export type CommonError =
  | "network_error"
  | "unauthenticated"
  | "not_a_clinician"
  | "not_available"
  | "rate_limited"
  | "server_error";

export type ApiError<E extends string> = { code: E | CommonError; status: number };

export type ApiResult<T, E extends string = never> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError<E> };

// ---------------------------------------------------------------------------
// Shared cycle state model (PRD v3: requested → approved → submitted → in_review →
// window_open → picked_up, with declined, rejected and missed as exits)
// ---------------------------------------------------------------------------

export const CYCLE_STATUSES = [
  "requested",
  "approved",
  "submitted",
  "in_review",
  "window_open",
  "picked_up",
  "declined",
  "rejected",
  "missed",
] as const;

export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** The happy path, in order. The exits replace the step they end on. */
export const CYCLE_PATH = ["requested", "approved", "submitted", "in_review", "window_open", "picked_up"] as const;

export const CYCLE_EXITS = ["declined", "rejected", "missed"] as const satisfies readonly CycleStatus[];

export type EmailStatus = "sent" | "failed" | "disabled";

/**
 * The patient's current cycle as the patient may see it. Never carries a token, link,
 * challenge code, reader output, confidence or flag.
 */
export type Cycle = {
  id: string;
  status: CycleStatus;
  /** When each status was reached; missing keys were not reached (or are unknown). */
  timestamps: Partial<Record<CycleStatus, string>>;
  /** Set while status is approved. */
  emailStatus: EmailStatus | null;
  /** Set while status is window_open (and kept for picked_up / missed). */
  pickupDeadline: string | null;
  declineReason: string | null;
  rejectReason: string | null;
  /** An unused, unexpired test link exists for this cycle (the "Start your test" fallback). */
  testLinkAvailable: boolean;
  /** After a decline: whether the patient may request again now. */
  canRequestAgain: boolean;
};

// ---------------------------------------------------------------------------
// Patient portal (needed from backend)
// ---------------------------------------------------------------------------

export type EnrollRequest = { enrollmentCode: string };
export type EnrollResponse = { patientId: string };
export type EnrollError = "invalid_code" | "expired_code" | "already_enrolled";

export type CycleResponse = { cycle: Cycle | null };
/** 403 not_enrolled: signed in, but the account isn't linked to a patient yet. */
export type CycleError = "not_enrolled";

export type RefillCreateResponse = { requestId: string };
export type RefillCreateError = "cycle_already_open" | "not_enrolled";

/**
 * POST /api/patient/test-link: for the "Start your test" fallback. The server returns the
 * same-origin path of a usable link for the current cycle (it may issue a fresh one); the
 * browser navigates there and never stores or logs it.
 */
export type PatientTestLinkResponse = { testPath: string };
export type PatientTestLinkError = "no_test_link" | "not_enrolled";

// ---------------------------------------------------------------------------
// Patient auth (Supabase Auth, called from the browser)
// ---------------------------------------------------------------------------

export type SignUpResponse = { needsEmailConfirmation: boolean };
export type SignUpError = "email_taken" | "weak_password" | "invalid_email" | "too_many_attempts";
export type SignInError = "bad_credentials";
/** The reset email is requested the same way whether or not the address has an account. */
export type PasswordResetError = never;

// ---------------------------------------------------------------------------
// Clinic: refill requests (needed from backend)
// ---------------------------------------------------------------------------

export type RefillRequestStatus = "requested" | "approved" | "declined" | "cancelled";

export type RefillRequest = {
  id: string;
  patientId: string;
  pseudonym: string;
  status: RefillRequestStatus;
  requestedAt: string;
  /** Set once approved. */
  emailStatus: EmailStatus | null;
  declineReason: string | null;
};

export type RefillListFilter = { status: RefillRequestStatus; emailStatus?: EmailStatus };

export type ApproveResponse = { emailStatus: EmailStatus };
export type ApproveError = "not_pending" | "not_found";

export type DeclineRequest = { reason: string };
export type DeclineResponse = { ok: true };
export type DeclineError = "not_pending" | "not_found" | "reason_required";

export type ResendResponse = { emailStatus: EmailStatus };
export type ResendError = "not_found" | "not_resendable";

// ---------------------------------------------------------------------------
// Clinic: enrollment (needed from backend)
// ---------------------------------------------------------------------------

export type EnrollmentCodeResponse = { code: string; expiresAt: string };
export type EnrollmentCodeError = "not_found" | "already_enrolled";

/** Portal state per patient for the /patients table. */
export type PatientPortalStatus = {
  patientId: string;
  enrolled: boolean;
  cycleStatus: CycleStatus | null;
};
export type PortalStatusResponse = { patients: PatientPortalStatus[] };

// ---------------------------------------------------------------------------
// Existing endpoints
// ---------------------------------------------------------------------------

/** POST /api/requests */
export type IssueLinkRequest = { patientId: string; setting: "home" | "clinic" };
export type IssueLinkResponse = { requestId: string; link: string; expiresAt: string };
export type IssueLinkError = "invalid_request" | "not_found" | "home_testing_not_allowed" | "issue_failed" | "audit_failed";
export type HomeRefusal = "not_permitted" | "pre_treatment" | "cannot_get_pregnant";

/** PATCH /api/patients/[id]/home-testing */
export type HomeTestingResponse = { patientId: string; allowed: boolean; changed: boolean };
/** audit_failed still saved the change (changed: true). */
export type HomeTestingError = "invalid_request" | "not_found" | "update_failed" | "audit_failed";

/** GET /api/queue. The grok fields below `codeMatches` are v3 additions and optional. */
export type QueueResponse = { cards: QueueCard[] };

/** POST /api/reviews */
export type ReviewDecision = "approved" | "rejected";
export type ReviewResponse = { status: ReviewDecision; window: { opensAt: string; closesAt: string } | null };
export type ReviewError =
  | "invalid_request"
  | "prescriber_only"
  | "forbidden"
  | "not_found"
  | "not_reviewable"
  | "already_reviewed"
  | "window_logic_unavailable"
  | "window_logic_failed"
  | "review_failed"
  | "audit_failed"
  | "photo_delete_failed";

/** POST /api/windows/fill ("Mark picked up") */
export type PickupResponse = { alreadyPickedUp: boolean; daysToFill: number | null };
export type PickupError = "not_found" | "not_open" | "invalid_request";

/**
 * POST /api/t/[token]/start. codeExpiresAt is a v3 addition (R13); when absent the
 * session deadline is the only clock.
 */
export type StartResponse = { sessionEndsAt: string; challengeCode: string; codeExpiresAt: string | null };
export type StartError =
  // Today (404 / 409)
  | "invalid"
  | "link_expired"
  | "session_expired"
  | "submitted"
  // v3 (R6, R7): 401, 403 and 410
  | "not_logged_in"
  | "wrong_patient"
  | "invalidated"
  | "expired"
  | "already_used";

/** POST /api/submissions */
export type SubmitPhotoResponse = { received: boolean; reason: string | null };
/** The pipeline's own reason strings (see capture-flow patientMessage). */
export type SubmitPhotoError = string;

/** GET /api/audit/verify and POST /api/anchors bodies live in components/audit/types.ts. */
export type AnchorError =
  | "nothing_to_anchor"
  | "solana_not_configured"
  | "wallet_needs_devnet_sol"
  | "solana_unavailable"
  | "anchor_not_recorded"
  | "anchor_failed";
export type VerifyError = "verify_failed";
