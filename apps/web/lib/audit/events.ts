// Audit event catalog.
// PROPOSAL — confirm with the team (Adrit, Labib, Nihalika) which actions each route logs.
//
// Anchoring is deliberately not an event: anchors live in the `anchors` table, and an
// event per anchor would move the head every time the head was anchored.

export const AUDIT_ACTIONS = [
  "request.issued",
  "session.started",
  "submission.received",
  "submission.rejected_link",
  "submission.rejected_fraud",
  "review.approved",
  "review.rejected",
  "window.filled",
  "window.missed",
  "patient.home_testing_changed",
  // Patient portal. The patient is the actor only for the request itself; every decision
  // on it is a clinician's and is logged under their id.
  "refill.requested",
  "refill.declined",
  "refill.linked",
  "patient.portal_linked",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}
