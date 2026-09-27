// POST /api/portal/refills — a patient asks their clinic to start a refill cycle.
// Owner: Labib.
//
// This is the only write a patient can make anywhere in PledgeCheck, and it is
// deliberately inert: it creates a row that says "I asked, at this time", and nothing
// else. It issues no test link, opens no window and changes no clinical state. A
// clinician decides what happens next.
//
// 401 no session · 403 not a linked patient · 409 already_pending · 409 clinic_visit_required
// · 500 request_failed
//
// The insert goes through the *user-scoped* client, not the service role, so the
// refill_requests_patient_insert policy is what proves the row belongs to the caller. A
// patient cannot file a request against someone else even if they forge the body,
// because the body carries no patient id at all.

import { NextResponse } from "next/server";

import { loadFailedTestRun } from "@/app/portal/load";
import { appendAuditEvent } from "@/lib/audit/append";
import { clinicVisitRequired } from "@/lib/portal/attempts";
import { getPatient } from "@/lib/portal/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST() {
  const supabase = await createClient();
  const auth = await getPatient(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  // One open request at a time. Asking twice does not make the clinic answer sooner, and
  // a queue of duplicates is noise on the clinician's screen.
  const { data: open, error: openError } = await supabase
    .from("refill_requests")
    .select("id")
    .eq("patient_id", auth.patient.id)
    .eq("status", "requested")
    .limit(1);
  if (openError) {
    console.error("[portal/refills] could not check for an open request", { cause: openError.message });
    return fail(500, "request_failed");
  }
  if (open && open.length > 0) return fail(409, "already_pending");

  // One failed test earns another link; two in a row means the clinic should see the patient
  // rather than read a third photo. The portal stops offering the button at the same point and
  // from the same count, so this is the backstop, not the first the patient hears of it.
  let failedTests: number;
  try {
    failedTests = await loadFailedTestRun(supabase);
  } catch (err) {
    console.error("[portal/refills] could not count earlier failed tests", {
      cause: err instanceof Error ? err.message : "unknown",
    });
    return fail(500, "request_failed");
  }
  if (clinicVisitRequired(failedTests)) return fail(409, "clinic_visit_required");

  const { data: created, error: insertError } = await supabase
    .from("refill_requests")
    .insert({ patient_id: auth.patient.id })
    .select("id, created_at")
    .single();

  if (insertError || !created) {
    console.error("[portal/refills] insert failed", { cause: insertError?.message ?? "no row" });
    return fail(500, "request_failed");
  }

  // The request is saved; an audit failure must not lose it. Same best-effort stance as
  // the submission pipeline, for the same reason.
  try {
    await appendAuditEvent({
      actor: `patient:${auth.patient.id}`,
      action: "refill.requested",
      refId: created.id,
      payload: {},
    });
  } catch (err) {
    console.error("[portal/refills] AUDIT EVENT NOT WRITTEN for refill.requested", {
      refillId: created.id,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }

  return NextResponse.json({ id: created.id, createdAt: created.created_at }, { status: 201 });
}
