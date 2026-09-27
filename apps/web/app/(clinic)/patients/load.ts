// Data for /patients, read as the signed-in clinician (RLS limits it to their practice).
// Three queries: patients, their test requests, and which requests have a photo.
import "server-only";

import type { CycleStatus } from "@/lib/api/contracts";
import { linkState, type LinkState } from "@/lib/fraud/session";
import { cycleStatusFor } from "@/lib/portal/cycle";
import { portalStatus, type SubmissionStatus, type WindowStatus } from "@/lib/portal/status";
import type { createClient } from "@/lib/supabase/server";

export type PatientRow = {
  id: string;
  pseudonym: string;
  phase: "pre" | "during" | "after" | "complete";
  language: "en" | "es";
  canGetPregnant: boolean;
  homeTestingAllowed: boolean;
  latest: { state: LinkState; setting: "home" | "clinic"; expiresAt: string } | null;
  /** The patient has a portal login linked to this record (patients.auth_user_id). */
  enrolled: boolean;
  /** Their newest refill request, as the clinic badge names it. Null if they never asked. */
  cycleStatus: CycleStatus | null;
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
    .select("id, pseudonym, phase, language, can_get_pregnant, home_testing_allowed, auth_user_id")
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
  const cycles = await loadCycleStatuses(supabase);

  return patients.map((p) => ({
    id: p.id,
    pseudonym: p.pseudonym,
    phase: p.phase as PatientRow["phase"],
    language: p.language === "es" ? "es" : "en",
    canGetPregnant: p.can_get_pregnant,
    homeTestingAllowed: p.home_testing_allowed,
    latest: latest.get(p.id) ?? null,
    enrolled: Boolean((p as { auth_user_id?: string | null }).auth_user_id),
    cycleStatus: cycles.get(p.id) ?? null,
  }));
}

/**
 * Newest refill request per patient, as a clinic-facing cycle status.
 *
 * Read through the same derivation the patient portal uses (lib/portal/status.ts), so the
 * badge a clinician reads and the status the patient reads can never disagree: there is
 * one function deciding, not two.
 *
 * A failure here is not worth losing the patient list over, so it yields an empty map.
 */
async function loadCycleStatuses(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, CycleStatus>> {
  const { data, error } = await supabase
    .from("refill_requests")
    .select(
      "patient_id, created_at, status, test_request_id, " +
        "test_requests(submissions(status, windows(status)))",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[patients] cycle statuses unavailable", { cause: error.message });
    return new Map();
  }

  const out = new Map<string, CycleStatus>();
  for (const row of data ?? []) {
    const r = row as unknown as {
      patient_id: string;
      status: "requested" | "linked" | "declined";
      test_request_id: string | null;
      test_requests: unknown;
    };
    // Ordered newest first, so the first row seen for a patient is their current one.
    if (out.has(r.patient_id)) continue;

    const testRequest = pick(r.test_requests) as { submissions: unknown } | null;
    const submission = pick(testRequest?.submissions) as { status: string; windows: unknown } | null;
    const window = pick(submission?.windows) as { status: string } | null;

    out.set(
      r.patient_id,
      cycleStatusFor(
        portalStatus({
          request: r.status,
          hasTestLink: r.test_request_id !== null,
          submission: (submission?.status as SubmissionStatus | undefined) ?? null,
          window: (window?.status as WindowStatus | undefined) ?? null,
        }),
      ),
    );
  }
  return out;
}

/** PostgREST hands back an embedded row as an object or a one-element array. */
function pick(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Refill requests still waiting on a decision, for this clinician's practice.
 *
 * Read as the signed-in clinician, so refill_requests_select (db/policies.sql) is what
 * limits it to their practice rather than a filter written here.
 */
export async function loadPendingRefills(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string; pseudonym: string; createdAt: string; contactEmail: string | null }[]> {
  const { data, error } = await supabase
    .from("refill_requests")
    .select("id, created_at, patients(pseudonym, contact_email)")
    .eq("status", "requested")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not load refill requests: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      created_at: string;
      patients: { pseudonym: string; contact_email: string | null } | { pseudonym: string; contact_email: string | null }[] | null;
    };
    const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    return {
      id: r.id,
      pseudonym: patient?.pseudonym ?? "Unknown patient",
      createdAt: r.created_at,
      contactEmail: patient?.contact_email ?? null,
    };
  });
}
