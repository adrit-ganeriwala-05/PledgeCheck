import "server-only";

// Reads for the patient portal. Owner: Labib.
//
// Every query here runs on the *user-scoped* client, never the service role, so RLS is
// doing the access control: the patient policies in db/policies.sql restrict each of
// these to the signed-in patient's own rows. If a policy is ever wrong, these queries
// return nothing rather than someone else's record.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Cycle } from "@/lib/api/contracts";
import { toCycle } from "@/lib/portal/cycle";
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

/**
 * The patient's most recent refill request, as the Cycle the portal renders.
 *
 * One row, newest first: the portal shows "this month", not a history. Null means the
 * patient has never asked for a refill, which is the screen that offers the button.
 *
 * Same user-scoped client as everything else here, so the patient policies in
 * db/policies.sql are what keep this to the caller's own request.
 */
export async function loadCurrentCycle(supabase: SupabaseClient<Database>): Promise<Cycle | null> {
  const { data, error } = await supabase
    .from("refill_requests")
    .select(
      "id, created_at, status, decline_reason, decided_at, test_request_id, " +
        "test_requests(expires_at, submissions(captured_at, status, reviews(reason, decided_at), windows(status, opens_at, closes_at, filled_at)))",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`could not load your cycle: ${error.message}`);
  if (!data) return null;

  const r = data as unknown as {
    id: string;
    created_at: string;
    status: "requested" | "linked" | "declined";
    decline_reason: string | null;
    decided_at: string | null;
    test_request_id: string | null;
    test_requests: unknown;
  };

  const testRequest = one(r.test_requests as { expires_at: string; submissions: unknown } | null);
  const submission = one(
    testRequest?.submissions as
      | { captured_at: string | null; status: string; reviews: unknown; windows: unknown }
      | { captured_at: string | null; status: string; reviews: unknown; windows: unknown }[]
      | null,
  );
  const review = one(submission?.reviews as { reason: string | null; decided_at: string } | null);
  const window = one(
    submission?.windows as { status: string; opens_at: string; closes_at: string; filled_at: string | null } | null,
  );

  return toCycle({
    id: r.id,
    status: portalStatus({
      request: r.status,
      hasTestLink: r.test_request_id !== null,
      submission: (submission?.status as SubmissionStatus | undefined) ?? null,
      window: (window?.status as WindowStatus | undefined) ?? null,
    }),
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    declineReason: r.decline_reason,
    capturedAt: submission?.captured_at ?? null,
    reviewReason: review?.reason ?? null,
    reviewedAt: review?.decided_at ?? null,
    windowOpensAt: window?.opens_at ?? null,
    windowClosesAt: window?.closes_at ?? null,
    windowFilledAt: window?.filled_at ?? null,
    linkExpiresAt: testRequest?.expires_at ?? null,
  });
}
