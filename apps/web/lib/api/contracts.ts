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
  "expired",
] as const;

export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** The happy path, in order. The exits replace the step they end on. */
export const CYCLE_PATH = ["requested", "approved", "submitted", "in_review", "window_open", "picked_up"] as const;

export const CYCLE_EXITS = ["declined", "rejected", "missed", "expired"] as const satisfies readonly CycleStatus[];

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
  /** After an exit (declined, rejected, expired): whether the patient may request again now. */
  canRequestAgain: boolean;
  /**
   * Set once the patient has used every home attempt in this run of failures
   * (lib/portal/attempts.ts). The portal stops offering a new request and asks them to come
   * in, which is what POST /api/portal/refills enforces with 409 clinic_visit_required.
   */
  clinicVisitRequired: boolean;
};

// ---------------------------------------------------------------------------
// Patient portal (needed from backend)
// ---------------------------------------------------------------------------

export type Clinic = { id: string; name: string; prescribers: string[] };
export type ClinicsResponse = { clinics: Clinic[] };

export type EnrollRequest = { practiceId: string };
export type EnrollResponse = { patientId: string; pseudonym: string };
export type EnrollError = "already_enrolled" | "unknown_practice" | "invalid_request";

export type CycleResponse = { cycle: Cycle | null };
/** 403 not_enrolled: signed in, but the account isn't linked to a patient yet. */
export type CycleError = "not_enrolled";

export type RefillCreateResponse = { requestId: string; createdAt: string };
/**
 * POST /api/portal/refills answers 409 already_pending while a request is open and 409
 * clinic_visit_required once the home attempts are used up; 403 when the login has no
 * patient row.
 */
export type RefillCreateError = "already_pending" | "clinic_visit_required" | "not_enrolled";

// ---------------------------------------------------------------------------
// Patient auth (Supabase Auth, called from the browser)
// ---------------------------------------------------------------------------

export type SignUpResponse = { needsEmailConfirmation: boolean };
export type SignUpError = "email_taken" | "weak_password" | "invalid_email" | "too_many_attempts";
export type SignInError = "bad_credentials";
/** The reset email is requested the same way whether or not the address has an account. */
export type PasswordResetError = never;
/**
 * Setting a new password from a recovery link. `no_session` means the link was never
 * exchanged for a session — expired, already used, or opened through a redirect that dropped
 * the token — and `same_password` is Supabase refusing a password the account already has.
 */
export type PasswordUpdateError = "no_session" | "weak_password" | "same_password";

// ---------------------------------------------------------------------------
// Clinic: refill requests (needed from backend)
// ---------------------------------------------------------------------------

/** db/schema.sql: refill_requests.status. `linked` is this backend's word for approved. */
export type RefillRequestStatus = "requested" | "linked" | "declined";

export type RefillRequest = {
  id: string;
  patientId: string;
  pseudonym: string;
  status: RefillRequestStatus;
  requestedAt: string;
  /** Whether the patient has an address on file, so the approval can be emailed at all. */
  hasEmail: boolean;
  declineReason: string | null;
};

/**
 * The inbox only ever lists requests still waiting on a decision. There is no stored
 * email outcome to filter on: the backend reports `emailed` in the approval response and
 * keeps no column for it, so a failed email is shown on the card that just failed.
 */
export type RefillListFilter = { status: "requested" };

export type ApproveResponse = { emailStatus: EmailStatus };
export type ApproveError = "already_decided" | "not_found" | "home_testing_not_allowed" | "issue_failed";

export type DeclineRequest = { reason: string };
export type DeclineResponse = { ok: true };
export type DeclineError = "already_decided" | "not_found" | "invalid_request";

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
