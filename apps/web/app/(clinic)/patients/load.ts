// Data for /patients, read as the signed-in clinician (RLS limits it to their practice).
// Three queries: patients, their test requests, and which requests have a photo.
import "server-only";

import { linkState, type LinkState } from "@/lib/fraud/session";
import type { createClient } from "@/lib/supabase/server";

export type PatientRow = {
  id: string;
  pseudonym: string;
  phase: "pre" | "during" | "after" | "complete";
  language: "en" | "es";
  canGetPregnant: boolean;
  homeTestingAllowed: boolean;
  latest: { state: LinkState; setting: "home" | "clinic"; expiresAt: string } | null;
};

type RequestRow = { id: string; patient_id: string; setting: string; expires_at: string; used_at: string | null };

/** Latest request per patient (by expires_at, which is issue time + 24 h) and its state. */
export function latestRequestStates(
  requests: RequestRow[],
  submittedRequestIds: Set<string>,
  now: Date,
): Map<string, NonNullable<PatientRow["latest"]>> {
  const latest = new Map<string, RequestRow>();
  for (const r of requests) {
    const current = latest.get(r.patient_id);
    if (!current || Date.parse(r.expires_at) > Date.parse(current.expires_at)) latest.set(r.patient_id, r);
  }
  const out = new Map<string, NonNullable<PatientRow["latest"]>>();
  for (const [patientId, r] of latest) {
    out.set(patientId, {
      state: linkState({ expires_at: r.expires_at, used_at: r.used_at, submitted: submittedRequestIds.has(r.id) }, now),
      setting: r.setting === "clinic" ? "clinic" : "home",
      expiresAt: r.expires_at,
    });
  }
  return out;
}

export async function loadPatients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  now: Date = new Date(),
): Promise<PatientRow[]> {
  const { data: patients, error } = await supabase
    .from("patients")
    .select("id, pseudonym, phase, language, can_get_pregnant, home_testing_allowed")
    .order("pseudonym");
  if (error) throw new Error("could not load patients");
  if (!patients || patients.length === 0) return [];

  const { data: requests, error: requestError } = await supabase
    .from("test_requests")
    .select("id, patient_id, setting, expires_at, used_at")
    .in(
      "patient_id",
      patients.map((p) => p.id),
    );
  if (requestError) throw new Error("could not load test requests");

  const requestIds = (requests ?? []).map((r) => r.id);
  let submitted = new Set<string>();
  if (requestIds.length > 0) {
    const { data: subs, error: subError } = await supabase
      .from("submissions")
      .select("request_id")
      .in("request_id", requestIds)
      .not("photo_path", "is", null);
    if (subError) throw new Error("could not load submissions");
    submitted = new Set((subs ?? []).map((s) => s.request_id));
  }

  const latest = latestRequestStates(requests ?? [], submitted, now);
  return patients.map((p) => ({
    id: p.id,
    pseudonym: p.pseudonym,
    phase: p.phase as PatientRow["phase"],
    language: p.language === "es" ? "es" : "en",
    canGetPregnant: p.can_get_pregnant,
    homeTestingAllowed: p.home_testing_allowed,
    latest: latest.get(p.id) ?? null,
  }));
}
