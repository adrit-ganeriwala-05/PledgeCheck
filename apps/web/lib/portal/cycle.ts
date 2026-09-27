// Translates one refill request into the Cycle the portal screens render. Owner: Labib.
//
// Two status vocabularies met in the v3 merge: the backend's PortalStatus (lib/portal/status.ts,
// derived from refill_requests -> submissions -> reviews -> windows) and the redesign's
// CycleStatus, which the timeline and copy maps are built on. The backend's is the real one,
// so this maps onto CycleStatus rather than the other way around, and nothing here decides
// anything: it renames and carries timestamps.
//
// Pure on purpose, so the mapping is tested without a database.

import type { Cycle, CycleStatus } from "@/lib/api/contracts";
import type { PortalStatus } from "@/lib/portal/status";

/** The database columns a cycle is built from. Times are ISO strings or null. */
export type CycleSource = {
  id: string;
  status: PortalStatus;
  createdAt: string;
  decidedAt: string | null;
  declineReason: string | null;
  /** When the patient's photo was taken. */
  capturedAt: string | null;
  /** The prescriber's note on a rejection. Reasons are already patient-safe. */
  reviewReason: string | null;
  reviewedAt: string | null;
  windowOpensAt: string | null;
  windowClosesAt: string | null;
  windowFilledAt: string | null;
  /** When the issued test link stops working. */
  linkExpiresAt: string | null;
  /**
   * Whether the patient has used up their home attempts (lib/portal/attempts.ts). Counted
   * across their earlier requests, so it is passed in rather than derived from this one row.
   */
  clinicVisitRequired: boolean;
};

/** PortalStatus is what the backend derives; CycleStatus is what the screens render. */
const STATUS: Record<PortalStatus, CycleStatus> = {
  pending: "requested",
  declined: "declined",
  test_required: "approved",
  in_review: "in_review",
  not_verified: "rejected",
  ready_for_pickup: "window_open",
  picked_up: "picked_up",
  window_missed: "missed",
  expired: "expired",
};

/**
 * Statuses that stop a patient asking again.
 *
 * Exactly one, because that is exactly what POST /api/portal/refills enforces by status: it
 * refuses with 409 already_pending only while a row is still `requested`. Blocking more here
 * than the server does would tell the patient "no" where the server would say yes.
 *
 * Its other refusal, 409 clinic_visit_required, turns on how many tests failed in a row
 * rather than on this status, so it travels on the cycle as `clinicVisitRequired`.
 */
export const BLOCKING_STATUSES: readonly CycleStatus[] = ["requested"];

/** The screens' name for a backend status. Used on its own by the clinic patients table. */
export function cycleStatusFor(status: PortalStatus): CycleStatus {
  return STATUS[status];
}

export function toCycle(source: CycleSource): Cycle {
  const status = STATUS[source.status];
  const timestamps: Partial<Record<CycleStatus, string>> = { requested: source.createdAt };

  // A decision timestamp means different things on the two exits it can produce.
  if (source.decidedAt) {
    timestamps[status === "declined" ? "declined" : "approved"] = source.decidedAt;
  }
  if (source.capturedAt) {
    timestamps.submitted = source.capturedAt;
    timestamps.in_review = source.capturedAt;
  }
  if (source.reviewedAt && status === "rejected") timestamps.rejected = source.reviewedAt;
  if (source.windowOpensAt) timestamps.window_open = source.windowOpensAt;
  if (source.windowFilledAt) timestamps.picked_up = source.windowFilledAt;
  if (source.windowClosesAt && status === "missed") timestamps.missed = source.windowClosesAt;
  if (source.linkExpiresAt && status === "expired") timestamps.expired = source.linkExpiresAt;

  return {
    id: source.id,
    status,
    timestamps,
    // The approval response reports whether the email went out, but no column stores it,
    // so a cycle read back later cannot know. Null reads as "check your email".
    emailStatus: null,
    pickupDeadline: source.windowClosesAt,
    declineReason: source.declineReason,
    rejectReason: source.reviewReason,
    canRequestAgain: !BLOCKING_STATUSES.includes(status) && !source.clinicVisitRequired,
    clinicVisitRequired: source.clinicVisitRequired,
  };
}
