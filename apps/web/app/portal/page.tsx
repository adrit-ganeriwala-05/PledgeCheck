// Patient portal at /portal. Owner: Labib.
//
// Read-only except for one button: "Request a refill". Everything else on this page is a
// report of what the clinic has done. The patient is inside the loop and can see exactly
// where they are, which is the point of the portal; they still cannot move themselves
// through it.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getPatient } from "@/lib/portal/auth";
import { STATUS_TEXT } from "@/lib/portal/status";
import { createClient } from "@/lib/supabase/server";

import { loadExams, loadRefills, type ExamRow, type RefillRow } from "./load";
import { RequestRefill } from "./request-refill";

export const metadata: Metadata = { title: "My care · PledgeCheck" };
export const dynamic = "force-dynamic";

const EXAM_LABEL: Record<string, string> = {
  awaiting_photo: "Not taken yet",
  needs_review: "In review",
  ready_for_review: "In review",
  approved: "Verified",
  rejected: "Not verified",
  rejected_fraud: "Not verified",
  expired: "Expired",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function PortalPage() {
  const supabase = await createClient();
  const auth = await getPatient(supabase);
  if (!auth.ok) redirect(auth.status === 401 ? "/portal/login" : "/portal/not-linked");

  let refills: RefillRow[] = [];
  let exams: ExamRow[] = [];
  let loadFailed = false;
  try {
    [refills, exams] = await Promise.all([loadRefills(supabase), loadExams(supabase)]);
  } catch (err) {
    loadFailed = true;
    console.error("[portal] load failed", err instanceof Error ? err.message : "unknown");
  }

  const hasOpenRequest = refills.some((r) => r.status === "pending");

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
      <header className="space-y-1">
        <p className="text-sm font-semibold tracking-widest uppercase">PledgeCheck</p>
        <h1 className="text-2xl font-semibold tracking-tight">My care</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {auth.patient.pseudonym}. Your clinic decides every step below.
        </p>
      </header>

      {loadFailed && (
        <p role="alert" className="rounded-md border p-4 text-sm">
          Could not load your record just now. Refresh to try again.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Refill requests</h2>
          <RequestRefill disabled={hasOpenRequest} />
        </div>
        {hasOpenRequest && (
          <p className="text-sm text-muted-foreground">
            You already have a request waiting. Your clinic will respond to that one.
          </p>
        )}
        {refills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {refills.map((r) => {
              const text = STATUS_TEXT[r.status];
              return (
                <li key={r.id} className="space-y-1 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{text.label}</span>
                    <span className="text-sm text-muted-foreground">{when(r.createdAt)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{text.detail}</p>
                  {r.declineReason && (
                    <p className="text-sm">
                      <span className="font-medium">From your clinic:</span> {r.declineReason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tests</h2>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tests yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {exams.map((e) => (
              <li key={e.id} className="space-y-1 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{EXAM_LABEL[e.status] ?? e.status}</span>
                  <span className="text-sm text-muted-foreground">{when(e.capturedAt)}</span>
                </div>
                {e.reason && (
                  <p className="text-sm">
                    <span className="font-medium">Note:</span> {e.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Test photos are deleted once your prescriber has reviewed them, so they are not shown here.
        </p>
      </section>
    </main>
  );
}
