// Adapter: append a clinic action to the hash-chained audit log.
// Owner of the real logic: Nihalika (apps/web/lib/audit). Never insert into
// audit_events directly and never compute hashes here.
//
// Expected contract:
//   append({ actor, action, refId, payload }): Promise<void>
//     actor:   "clinician:<uuid>"
//     action:  e.g. "review.approved" | "review.rejected" (PRD example; final names pending)
//     refId:   uuid of the affected row (here, the submission) or null
//     payload: JSON object, no patient identifiers beyond ids
//   Rejects if the event could not be written; POST /api/reviews then answers
//   500 audit_failed with reviewRecorded: true after the decision is saved.
//
// Delegates to lib/audit/append.ts, which validates the actor, the action (against the
// catalog in lib/audit/events.ts) and the payload before writing.
import { appendAuditEvent } from "@/lib/audit/append";
import type { AuditAction } from "@/lib/audit/events";

export type AuditEvent = {
  actor: string;
  action: string;
  refId: string | null;
  payload: Record<string, unknown>;
};

export async function append(event: AuditEvent): Promise<void> {
  await appendAuditEvent({
    actor: event.actor,
    action: event.action as AuditAction,
    refId: event.refId,
    payload: event.payload,
  });
}
