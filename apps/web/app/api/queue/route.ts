// GET /api/queue — reviewable submissions for the signed-in clinician's practice.
// Owner: Adrit. Everything is read through the user-scoped client, so RLS limits rows
// and photos to the clinician's practice. rejected_fraud never appears.
import { NextResponse } from "next/server";

import { getClinician } from "@/lib/clinic/auth";
import { buildCards, PHOTO_URL_TTL_SECONDS, type QueueResponse, type SubmissionRow, type WindowRow } from "@/lib/clinic/queue";
import { REVIEWABLE_STATUSES } from "@/lib/clinic/review";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET() {
  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  const { data: rows, error } = await supabase
    .from("submissions")
    .select(
      "id, status, captured_at, photo_path, grok_result, grok_code, grok_confidence, cv_result, cv_confidence, flags, " +
        "test_requests!inner(challenge_code, patient_id, patients!inner(pseudonym, phase, language))",
    )
    .in("status", [...REVIEWABLE_STATUSES])
    .returns<SubmissionRow[]>();
  if (error) {
    console.error("[queue] submissions query failed", { code: error.code });
    return fail(500, "queue_failed");
  }
  const submissions = rows ?? [];

  const patientIds = [...new Set(submissions.map((r) => r.test_requests?.patient_id).filter(Boolean))] as string[];
  let windows: WindowRow[] = [];
  if (patientIds.length > 0) {
    const { data, error: windowError } = await supabase
      .from("windows")
      .select("patient_id, opens_at, closes_at, is_first_rx")
      .in("patient_id", patientIds)
      .eq("status", "open");
    if (windowError) {
      console.error("[queue] windows query failed", { code: windowError.code });
      return fail(500, "queue_failed");
    }
    windows = data ?? [];
  }

  // A missing object yields no URL for that path; the card shows "photo unavailable".
  const signedUrls = new Map<string, string>();
  const paths = submissions.map((r) => r.photo_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("photos").createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl && !item.error) signedUrls.set(item.path, item.signedUrl);
    }
  }

  const body: QueueResponse = {
    cards: buildCards(submissions, windows, signedUrls, auth.clinician.role === "prescriber"),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
