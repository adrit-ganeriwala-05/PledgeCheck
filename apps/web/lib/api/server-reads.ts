"use server";

// The two reads the v3 screens need that have no HTTP route behind them.
//
// Everything else in lib/api/client.ts is a fetch to a real endpoint. The patient's cycle
// and the clinician's refill inbox are only ever read by our own screens, and the backend
// exposes them through RLS rather than through /api, so they are server actions: the query
// runs on the server as the signed-in user, and the browser gets rows, not a new public
// surface to defend. Adding /api routes for them would widen the attack surface for no one
// but us.
//
// Both go through the user-scoped Supabase client, so db/policies.sql is the access
// control here exactly as it is for the server components.

import { loadCurrentCycle } from "@/app/portal/load";
import type { ApiResult, CycleResponse, CycleError, RefillRequest } from "@/lib/api/contracts";
import { getClinician } from "@/lib/clinic/auth";
import { getPatient } from "@/lib/portal/auth";
import { createClient } from "@/lib/supabase/server";

export async function readPatientCycle(): Promise<ApiResult<CycleResponse, CycleError>> {
  const supabase = await createClient();
  const auth = await getPatient(supabase);
  if (!auth.ok) {
    return {
      ok: false,
      error: { code: auth.status === 401 ? "unauthenticated" : "not_enrolled", status: auth.status },
    };
  }
  try {
    return { ok: true, data: { cycle: await loadCurrentCycle(supabase) } };
  } catch (err) {
    console.error("[portal] cycle read failed", err instanceof Error ? err.message : "unknown");
    return { ok: false, error: { code: "server_error", status: 500 } };
  }
}

/**
 * Refill requests still waiting on a decision, for the caller's practice.
 *
 * Only `requested` rows: refill_requests has no stored email outcome, so there is no
 * "approved but the email failed" list to fetch. The inbox shows that outcome on the card
 * that just failed instead.
 */
export async function readRefillRequests(): Promise<ApiResult<RefillRequest[]>> {
  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) {
    return { ok: false, error: { code: auth.status === 401 ? "unauthenticated" : "not_a_clinician", status: auth.status } };
  }

  const { data, error } = await supabase
    .from("refill_requests")
    .select("id, created_at, status, decline_reason, patient_id, patients(pseudonym, contact_email)")
    .eq("status", "requested")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[requests] inbox read failed", { cause: error.message });
    return { ok: false, error: { code: "server_error", status: 500 } };
  }

  const rows = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      created_at: string;
      status: "requested" | "linked" | "declined";
      decline_reason: string | null;
      patient_id: string;
      patients: { pseudonym: string; contact_email: string | null } | { pseudonym: string; contact_email: string | null }[] | null;
    };
    const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    return {
      id: r.id,
      patientId: r.patient_id,
      pseudonym: patient?.pseudonym ?? "Unknown patient",
      status: r.status,
      requestedAt: r.created_at,
      hasEmail: Boolean(patient?.contact_email),
      declineReason: r.decline_reason,
    } satisfies RefillRequest;
  });

  return { ok: true, data: rows };
}
