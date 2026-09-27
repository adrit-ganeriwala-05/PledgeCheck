// POST /api/portal/enroll — a freshly signed-up patient joins a practice.
// Owner: Labib.
//
// Body: { practiceId }. Creates the caller's patient record and links it to their login.
//
// This is self-enrolment, which is a real departure from how the rest of the system
// works: everywhere else a clinician acts first. It is safe here only because of what the
// new row contains, and those values are the point, not incidental defaults:
//
//   home_testing_allowed = true    the prescriber's permission, pre-granted
//   phase                = 'pre'   iPLEDGE rule 1 keeps a pre-treatment test in a medical
//                                  setting. This is what actually holds a new patient:
//                                  homeRefusal() checks phase before it checks the
//                                  permission flag, and the rules engine blocks again at
//                                  submission time via treatmentHasStarted()
//   can_get_pregnant     = true    the conservative direction: testing requirements apply.
//                                  false would remove them from the testing loop entirely,
//                                  which is the dangerous value to guess wrong
//
// So a self-enrolled patient can sign in, see an empty record and ask for a refill. They
// cannot cause a test to be accepted. Every step after this is still a clinician's.
//
// 400 invalid_request · 401 · 409 already_enrolled · 404 unknown_practice · 500 enroll_failed

import { NextResponse } from "next/server";
import { z } from "zod";

import { appendAuditEvent } from "@/lib/audit/append";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({ practiceId: z.guid() });

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** A label for clinic screens. No part of a patient's real identity goes in the schema. */
function generatePseudonym(): string {
  return `PT-${Math.floor(1000 + Math.random() * 9000)}`;
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
  const { practiceId } = parsed.data;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return fail(401, "unauthenticated");

  const admin = createAdminClient();

  // One patient record per login. Re-enrolling would orphan the first record and its
  // history, so the second attempt is refused rather than silently creating a duplicate.
  const { data: existing, error: existingError } = await admin
    .from("patients")
    .select("id")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (existingError) return fail(500, "enroll_failed");
  if (existing) return fail(409, "already_enrolled");

  const { data: practice, error: practiceError } = await admin
    .from("practices")
    .select("id")
    .eq("id", practiceId)
    .maybeSingle();
  if (practiceError) return fail(500, "enroll_failed");
  if (!practice) return fail(404, "unknown_practice");

  const { data: created, error: insertError } = await admin
    .from("patients")
    .insert({
      practice_id: practiceId,
      pseudonym: generatePseudonym(),
      can_get_pregnant: true,
      home_testing_allowed: true,
      phase: "pre",
      auth_user_id: auth.user.id,
      contact_email: auth.user.email ?? null,
    })
    .select("id, pseudonym")
    .single();

  if (insertError || !created) {
    console.error("[portal/enroll] insert failed", { cause: insertError?.message ?? "no row" });
    return fail(500, "enroll_failed");
  }

  // The record exists; an audit failure must not lose it.
  try {
    await appendAuditEvent({
      actor: `patient:${created.id}`,
      action: "patient.portal_linked",
      refId: created.id,
      payload: {},
    });
  } catch (err) {
    console.error("[portal/enroll] AUDIT EVENT NOT WRITTEN for patient.portal_linked", {
      patientId: created.id,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }

  return NextResponse.json({ id: created.id, pseudonym: created.pseudonym }, { status: 201 });
}
