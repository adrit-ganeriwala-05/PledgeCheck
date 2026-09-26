// PATCH /api/patients/:id/home-testing — turn home testing on or off. Owner: Nihalika (N6).
// Body: { allowed: boolean } → 200 { patientId, allowed, changed }
//
// Clinicians have no client UPDATE policy on patients, so this route checks the clinician
// and the practice with the user-scoped client (RLS), then updates with the service role.
// Staff and prescribers may both toggle (open decision; see lib/fraud/README.md).
//
// 400 invalid body/id · 401 no session · 403 not a clinician · 404 other practice or unknown
// 500 update_failed · 500 audit_failed (with changed: true: the setting is saved)
import { NextResponse } from "next/server";
import { z } from "zod";

import { appendAuditEvent } from "@/lib/audit/append";
import { getClinician } from "@/lib/clinic/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({ allowed: z.boolean() });
// z.guid(): any 8-4-4-4-12 hex id (seeded ids are not RFC-4122 versioned).
const idSchema = z.guid();

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/patients/[id]/home-testing">) {
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
  const { allowed } = parsed.data;

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  // RLS hides other practices' patients, so they read as not found.
  const { data: patient, error: loadError } = await supabase
    .from("patients")
    .select("id, practice_id, home_testing_allowed")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return fail(500, "update_failed");
  if (!patient || patient.practice_id !== auth.clinician.practiceId) return fail(404, "not_found");

  if (patient.home_testing_allowed === allowed) {
    return NextResponse.json({ patientId: id, allowed, changed: false });
  }

  const { error: updateError } = await createAdminClient()
    .from("patients")
    .update({ home_testing_allowed: allowed })
    .eq("id", id)
    .eq("practice_id", auth.clinician.practiceId);
  if (updateError) {
    console.error("[patients] home-testing update failed", updateError.message);
    return fail(500, "update_failed");
  }

  try {
    await appendAuditEvent({
      actor: `clinician:${auth.clinician.id}`,
      action: "patient.home_testing_changed",
      refId: id,
      payload: { allowed },
    });
  } catch (err) {
    console.error("[patients] AUDIT EVENT NOT WRITTEN — home testing changed but missing from the audit log", {
      patientId: id,
      cause: err instanceof Error ? err.message : "unknown",
    });
    return fail(500, "audit_failed", { changed: true, allowed });
  }

  return NextResponse.json({ patientId: id, allowed, changed: true });
}
