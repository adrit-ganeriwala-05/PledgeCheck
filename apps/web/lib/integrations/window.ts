// Adapter: approval window from the rules engine.
// Contract: Adrit (A5). Logic: Labib (L3, apps/web/lib/rules). Do not compute dates here.
//
//   openApprovalWindow({ patientId, submissionId, approvedAt })
//     patientId, submissionId: uuid strings
//     approvedAt: ISO 8601 timestamp of the prescriber's approval
//   resolves to { opensAt, closesAt, isFirstRx }
//   The result is passed to public.submit_review, which inserts the windows row.
//
// The dates come from windowFor() in the rules engine, so the 7-day window here and the
// one the engine proposes at submission time can never drift apart.
import "server-only";

import { windowFor } from "@/lib/rules/engine";
import { createAdminClient } from "@/lib/supabase/admin";

export type ApprovalWindowInput = {
  patientId: string;
  submissionId: string;
  approvedAt: string;
};

export type ApprovalWindow = {
  opensAt: string;
  closesAt: string;
  isFirstRx: boolean;
};

export async function openApprovalWindow(input: ApprovalWindowInput): Promise<ApprovalWindow> {
  const approvedAt = new Date(input.approvedAt);
  if (Number.isNaN(approvedAt.getTime())) {
    throw new Error(`openApprovalWindow: approvedAt is not a date: ${input.approvedAt}`);
  }

  // First prescription means no earlier window for this patient. The service role is used
  // because this runs inside POST /api/reviews, which has already authorized the caller.
  const db = createAdminClient();
  const { count, error } = await db
    .from("windows")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", input.patientId);

  if (error) {
    throw new Error(`openApprovalWindow: could not count earlier windows: ${error.message}`);
  }

  return { ...windowFor(approvedAt), isFirstRx: (count ?? 0) === 0 };
}
