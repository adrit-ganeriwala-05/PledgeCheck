// POST /api/refills/[id]/decision — a clinician answers a patient's refill request.
// Owner: Labib.
//
// This is where "the power is always with the clinical staff" actually lives. A patient's
// request sits at `requested` until this route runs; nothing they can do moves it.
//
// Approve issues a test link through the shared minter and emails it to the patient. It
// does not approve a prescription: a refill still requires a negative test, read by both
// readers and approved by a prescriber, exactly as before. Approving the *request* only
// means "yes, start your test".
//
// 400 invalid_request · 401 · 403 not_a_clinician · 404 not_found
// · 409 already_decided · 500 issue_failed / audit_failed / decision_failed

import { NextResponse } from "next/server";
import { z } from "zod";

import { appendAuditEvent } from "@/lib/audit/append";
import { getClinician } from "@/lib/clinic/auth";
import { issueAndEmailTestLink } from "@/lib/requests/email-link";
import { issueTestLink, linkOrigin } from "@/lib/requests/issue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const idSchema = z.guid();
const bodySchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    setting: z.enum(["home", "clinic"]).default("home"),
  }),
  z.object({
    decision: z.literal("decline"),
    // A declined request without a reason is a dead end for the patient.
    reason: z.string().trim().min(1).max(500),
  }),
]);

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: Request, ctx: RouteContext<"/api/refills/[id]/decision">) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) return fail(400, "invalid_request");

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid_request");
  const body = parsed.data;

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);
  const clinician = auth.clinician;

  // RLS hides other practices' requests, so they read as not found.
  const { data: refill, error: loadError } = await supabase
    .from("refill_requests")
    .select("id, status, patient_id, patients(id, practice_id, contact_email, can_get_pregnant, home_testing_allowed, phase)")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return fail(500, "decision_failed");
  if (!refill) return fail(404, "not_found");
  if (refill.status !== "requested") return fail(409, "already_decided");

  const patient = (Array.isArray(refill.patients) ? refill.patients[0] : refill.patients) as {
    id: string;
    practice_id: string;
    contact_email: string | null;
    can_get_pregnant: boolean;
    home_testing_allowed: boolean;
    phase: string;
  } | null;
  if (!patient || patient.practice_id !== clinician.practiceId) return fail(404, "not_found");

  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (body.decision === "decline") {
    const { error } = await admin
      .from("refill_requests")
      .update({ status: "declined", decline_reason: body.reason, decided_by: clinician.id, decided_at: now })
      .eq("id", id)
      .eq("status", "requested");
    if (error) return fail(500, "decision_failed");

    // The decision is saved; an audit failure must not undo it.
    try {
      await appendAuditEvent({
        actor: `clinician:${clinician.id}`,
        action: "refill.declined",
        refId: id,
        payload: {},
      });
    } catch (err) {
      console.error("[refills] AUDIT EVENT NOT WRITTEN for refill.declined", {
        refillId: id,
        cause: err instanceof Error ? err.message : "unknown",
      });
    }
    return NextResponse.json({ ok: true, decision: "declined" });
  }

  // Approve. Nihalika's issuer does the patient lookup, the practice check and the
  // home-testing guard itself, so this route does not repeat them; a patient who is not
  // cleared to test at home is refused here exactly as they are on POST /api/requests.
  //
  // With an address on file the link is emailed; without one it is still issued and
  // returned, so the clinician can read it out or show the QR code.
  const origin = linkOrigin(request);
  const common = {
    supabase,
    clinician,
    patientId: patient.id,
    setting: body.setting,
    origin,
  };
  const issued = patient.contact_email
    ? await issueAndEmailTestLink({ ...common, email: patient.contact_email })
    : { ...(await issueTestLink(common)), emailed: false as const };

  if (!issued.ok) return fail(issued.status, issued.error, issued.extra);

  const { error: updateError } = await admin
    .from("refill_requests")
    .update({ status: "linked", test_request_id: issued.requestId, decided_by: clinician.id, decided_at: now })
    .eq("id", id)
    .eq("status", "requested");
  if (updateError) {
    // The link exists and is audited; only the join back to the request failed. Report it
    // rather than silently issuing a link the patient's portal will never show.
    console.error("[refills] could not attach the issued link to the request", {
      refillId: id,
      requestId: issued.requestId,
    });
    return fail(500, "decision_failed");
  }

  try {
    await appendAuditEvent({
      actor: `clinician:${clinician.id}`,
      action: "refill.linked",
      refId: id,
      payload: {},
    });
  } catch (err) {
    console.error("[refills] AUDIT EVENT NOT WRITTEN for refill.linked", {
      refillId: id,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }

  return NextResponse.json(
    { ok: true, decision: "linked", link: issued.link, expiresAt: issued.expiresAt, emailed: issued.emailed },
    { headers: { "Cache-Control": "no-store" } },
  );
}
