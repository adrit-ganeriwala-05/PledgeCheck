// POST /api/requests — a clinician issues a one-time test link. Owner: Nihalika (N1).
// Body: { patientId, setting: "home" | "clinic" } → 200 { requestId, link, expiresAt }
//
// The challenge code is generated and stored here but NOT returned: it stays secret until
// the patient taps Start (POST /api/t/:token/start). The plain token appears only in the
// returned link; the database keeps its hash.
//
// 400 invalid body · 401 no session · 403 not a clinician · 404 patient not visible
// (other practice) · 409 home_testing_not_allowed · 500 issue_failed / audit_failed
import { NextResponse } from "next/server";
import { z } from "zod";

import { getClinician } from "@/lib/clinic/auth";
import { issueTestLink } from "@/lib/clinic/issue-link";
import { homeRefusal } from "@/lib/fraud/home-guards";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const PRODUCTION_ORIGIN = "https://pledgecheck.tech";

const bodySchema = z.object({
  // z.guid(): any 8-4-4-4-12 hex id (seeded ids are not RFC-4122 versioned).
  patientId: z.guid(),
  setting: z.enum(["home", "clinic"]),
});

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

function linkOrigin(request: Request): string {
  return process.env.NODE_ENV === "production" ? PRODUCTION_ORIGIN : new URL(request.url).origin;
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid_request");
  const { patientId, setting } = parsed.data;

  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);
  const clinician = auth.clinician;

  // RLS hides other practices' patients, so they read as not found.
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id, practice_id, can_get_pregnant, home_testing_allowed, phase")
    .eq("id", patientId)
    .maybeSingle();
  if (patientError) return fail(500, "issue_failed");
  if (!patient || patient.practice_id !== clinician.practiceId) return fail(404, "not_found");

  if (setting === "home") {
    const refusal = homeRefusal(patient);
    if (refusal) return fail(409, "home_testing_not_allowed", { reason: refusal });
  }

  const issued = await issueTestLink({ patientId: patient.id, setting, clinicianId: clinician.id });
  if (!issued.ok) return fail(500, issued.error);

  return NextResponse.json(
    {
      requestId: issued.requestId,
      link: `${linkOrigin(request)}/t/${issued.token}`,
      expiresAt: issued.expiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
