import "server-only";

// Reads for the patient portal. Owner: Labib.
//
// Every query here runs on the *user-scoped* client, never the service role, so RLS is
// doing the access control: the patient policies in db/policies.sql restrict each of
// these to the signed-in patient's own rows. If a policy is ever wrong, these queries
// return nothing rather than someone else's record.

import type { SupabaseClient } from "@supabase/supabase-js";

import { portalStatus, type PortalStatus, type SubmissionStatus, type WindowStatus } from "@/lib/portal/status";
import type { Database } from "@/lib/supabase/types";

export type RefillRow = {
  id: string;
  createdAt: string;
  status: PortalStatus;
  declineReason: string | null;
};

export type ExamRow = {
  id: string;
  /** When the photo was taken. Null while a link has been issued but not used. */
  capturedAt: string | null;
  status: SubmissionStatus;
  /** The prescriber's note, when there is one. Reasons are already patient-safe. */
  reason: string | null;
};

/** PostgREST returns an embedded row as an object or a one-element array depending on the join. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadRefills(supabase: SupabaseClient<Database>): Promise<RefillRow[]> {
  const { data, error } = await supabase
    .from("refill_requests")
    .select(
      "id, created_at, status, decline_reason, test_request_id, " +
        "test_requests(id, submissions(id, status, windows(status)))",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`could not load refill requests: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      created_at: string;
      status: "requested" | "linked" | "declined";
      decline_reason: string | null;
      test_request_id: string | null;
      test_requests: { submissions: unknown } | { submissions: unknown }[] | null;
    };

    const testRequest = one(r.test_requests);
    const submission = one(
      testRequest?.submissions as
        | { status: string; windows: unknown }
        | { status: string; windows: unknown }[]
        | null,
    );
    const window = one(submission?.windows as { status: string } | { status: string }[] | null);

    return {
      id: r.id,
      createdAt: r.created_at,
      status: portalStatus({
        request: r.status,
        hasTestLink: r.test_request_id !== null,
        submission: (submission?.status as SubmissionStatus | undefined) ?? null,
        window: (window?.status as WindowStatus | undefined) ?? null,
      }),
      declineReason: r.decline_reason,
    };
  });
}

/**
 * The patient's own test history: one row per submission they made.
 *
 * Photos are never included. The photo is deleted once a prescriber decides, and a
 * patient re-reading their own test image serves no clinical purpose.
 */
export async function loadExams(supabase: SupabaseClient<Database>): Promise<ExamRow[]> {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, captured_at, status, reviews(reason)")
    // captured_at is null until the photo is taken, so unused links sort last.
    .order("captured_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`could not load tests: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      captured_at: string | null;
      status: string;
      reviews: { reason: string | null } | { reason: string | null }[] | null;
    };
    return {
      id: r.id,
      capturedAt: r.captured_at,
      status: r.status as SubmissionStatus,
      reason: one(r.reviews)?.reason ?? null,
    };
  });
}
