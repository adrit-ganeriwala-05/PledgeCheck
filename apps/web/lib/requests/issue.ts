// Issue a one-time test link for a patient. Shared by POST /api/requests (clinician copies
// the link or shows a QR code) and the refill approval (link is emailed to the patient).
//
// The challenge code is generated and stored here but NOT returned: it stays secret until
// the patient taps Start (POST /api/t/:token/start). The plain token appears only in the
// returned link; the database keeps its hash.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appendAuditEvent } from "@/lib/audit/append";
import type { Clinician } from "@/lib/clinic/auth";
import { generateChallengeCode } from "@/lib/fraud/code";
import { homeRefusal } from "@/lib/fraud/home-guards";
import { linkExpiresAt } from "@/lib/fraud/session";
import { generateToken, hashToken } from "@/lib/fraud/token";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const PRODUCTION_ORIGIN = "https://pledgecheck.tech";

export type IssueTestLinkInput = {
  // The signed-in clinician's client: RLS hides other practices' patients.
  supabase: SupabaseClient<Database>;
  clinician: Clinician;
  patientId: string;
  setting: "home" | "clinic";
  // Where /t/:token is served; see linkOrigin.
  origin: string;
};

export type IssuedTestLink = {
  ok: true;
  requestId: string;
  link: string;
  expiresAt: string;
  patient: { id: string; language: "en" | "es" };
};

export type IssueTestLinkFailure = {
  ok: false;
  status: 404 | 409 | 500;
  error: "not_found" | "home_testing_not_allowed" | "issue_failed" | "audit_failed";
  extra?: Record<string, unknown>;
};

export function linkOrigin(request: Request): string {
  return process.env.NODE_ENV === "production" ? PRODUCTION_ORIGIN : new URL(request.url).origin;
}

export async function issueTestLink(
  input: IssueTestLinkInput,
): Promise<IssuedTestLink | IssueTestLinkFailure> {
  const { supabase, clinician, patientId, setting, origin } = input;

  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id, practice_id, can_get_pregnant, home_testing_allowed, phase, language")
    .eq("id", patientId)
    .maybeSingle();
  if (patientError) return { ok: false, status: 500, error: "issue_failed" };
  if (!patient || patient.practice_id !== clinician.practiceId) {
    return { ok: false, status: 404, error: "not_found" };
  }

  if (setting === "home") {
    const refusal = homeRefusal(patient);
    if (refusal) {
      return { ok: false, status: 409, error: "home_testing_not_allowed", extra: { reason: refusal } };
    }
  }

  const token = generateToken();
  const expiresAt = linkExpiresAt(new Date()).toISOString();

  const admin = createAdminClient();
  const { data: created, error: insertError } = await admin
    .from("test_requests")
    .insert({
      patient_id: patient.id,
      token_hash: hashToken(token),
      challenge_code: generateChallengeCode(),
      setting,
      expires_at: expiresAt,
      created_by: clinician.id,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    console.error("[requests] insert failed", insertError?.message ?? "no row");
    return { ok: false, status: 500, error: "issue_failed" };
  }

  // No link leaves the server without its audit event. On failure the row is orphaned
  // but unusable: nobody ever sees its token.
  try {
    await appendAuditEvent({
      actor: `clinician:${clinician.id}`,
      action: "request.issued",
      refId: created.id,
      payload: { setting },
    });
  } catch (err) {
    console.error("[requests] AUDIT EVENT NOT WRITTEN — link withheld", {
      requestId: created.id,
      cause: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, status: 500, error: "audit_failed" };
  }

  return {
    ok: true,
    requestId: created.id,
    link: `${origin}/t/${token}`,
    expiresAt,
    patient: { id: patient.id, language: patient.language === "es" ? "es" : "en" },
  };
}
