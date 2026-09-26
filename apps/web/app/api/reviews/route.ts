// POST /api/reviews — a prescriber approves or rejects one submission.
// Owner: Adrit. Contract: { submissionId, decision, reason? } → 200 { status, window }.
//
// Order: validate → authorize → (approve) get the window from the rules engine → record
// the decision atomically via public.submit_review (user-scoped, so RLS and the function's
// own checks apply) → audit event → delete the photo. This route does no date math.
import { NextResponse } from "next/server";

import { getClinician } from "@/lib/clinic/auth";
import {
  mapSubmitReviewError,
  REVIEWABLE_STATUSES,
  reviewBodySchema,
  submitReviewResultSchema,
} from "@/lib/clinic/review";
import * as auditAdapter from "@/lib/integrations/audit";
import { IntegrationUnavailableError } from "@/lib/integrations/errors";
import * as windowAdapter from "@/lib/integrations/window";
import type { ApprovalWindow } from "@/lib/integrations/window";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = reviewBodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(400, "invalid_request", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const { submissionId, decision, reason } = parsed.data;

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);
  if (auth.clinician.role !== "prescriber") return fail(403, "prescriber_only");
  const clinicianId = auth.clinician.id;

  // RLS hides other practices' submissions, so they read as not found.
  const { data: submission, error: loadError } = await supabase
    .from("submissions")
    .select("id, status, photo_path, test_requests(patient_id)")
    .eq("id", submissionId)
    .maybeSingle();
  if (loadError) return fail(500, "review_failed");
  if (!submission || !submission.test_requests) return fail(404, "not_found");
  if (!(REVIEWABLE_STATUSES as readonly string[]).includes(submission.status)) {
    return fail(409, "not_reviewable");
  }

  let window: ApprovalWindow | null = null;
  if (decision === "approved") {
    try {
      window = await windowAdapter.openApprovalWindow({
        patientId: submission.test_requests.patient_id,
        submissionId,
        approvedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof IntegrationUnavailableError) return fail(503, "window_logic_unavailable");
      console.error("[reviews] window logic failed; nothing written", { submissionId });
      return fail(500, "window_logic_failed");
    }
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("submit_review", {
    p_submission_id: submissionId,
    p_decision: decision,
    // The generated type marks p_reason non-null, but the SQL function accepts null.
    p_reason: (reason ?? null) as string,
    p_window: window
      ? { opens_at: window.opensAt, closes_at: window.closesAt, is_first_rx: window.isFirstRx }
      : null,
  });
  if (rpcError) {
    const mapped = mapSubmitReviewError(rpcError.code);
    if (mapped.status === 500) console.error("[reviews] submit_review failed", { submissionId, code: rpcError.code });
    return fail(mapped.status, mapped.error);
  }
  const result = submitReviewResultSchema.safeParse(rpcData);
  if (!result.success) {
    console.error("[reviews] unexpected submit_review result", { submissionId });
    return fail(500, "review_failed", { reviewRecorded: true });
  }

  // From here the decision is saved; failures are reported, never hidden.
  let auditFailed = false;
  try {
    await auditAdapter.append({
      actor: `clinician:${clinicianId}`,
      action: decision === "approved" ? "review.approved" : "review.rejected",
      refId: submissionId,
      payload: { decision, reason: reason ?? null },
    });
  } catch (err) {
    auditFailed = true;
    console.error("[reviews] AUDIT EVENT NOT WRITTEN — review is recorded but missing from the audit log", {
      submissionId,
      decision,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }

  // The photo is deleted even if the audit write failed: keeping it helps nobody.
  const photoDeleted = await deletePhoto(submissionId, submission.photo_path);

  if (auditFailed) return fail(500, "audit_failed", { reviewRecorded: true });
  if (!photoDeleted) return fail(500, "photo_delete_failed", { reviewRecorded: true });

  const saved = result.data;
  return NextResponse.json({
    status: saved.status,
    window: saved.window ? { opensAt: saved.window.opens_at, closesAt: saved.window.closes_at } : null,
  });
}

// Removes the photo object, then clears photo_path (phash and reads are kept).
// An object that is already missing counts as deleted.
async function deletePhoto(submissionId: string, photoPath: string | null): Promise<boolean> {
  if (!photoPath) return true;
  try {
    const admin = createAdminClient();
    const { error: removeError } = await admin.storage.from("photos").remove([photoPath]);
    if (removeError) throw removeError;
    const { error: updateError } = await admin
      .from("submissions")
      .update({ photo_path: null })
      .eq("id", submissionId);
    if (updateError) throw updateError;
    return true;
  } catch {
    console.error("[reviews] PHOTO NOT DELETED — review is recorded", { submissionId });
    return false;
  }
}
