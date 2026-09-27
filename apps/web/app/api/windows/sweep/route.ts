// POST /api/windows/sweep — close out windows whose pickup deadline has passed.
// Owner: Labib (ticket L7).
//
// Nothing else in the system ever writes `missed`. The windows list derives it in the
// browser from the countdown reaching zero (see (clinic)/windows/window-list.tsx), which
// is a display state only: no row changes, so no audit event is written and the warehouse
// never learns a window was missed. That is why the dashboard's "Windows missed" column
// was always empty. This route is the one server-side moment the transition happens.
//
// Idempotent and race-safe: every update is conditional on the row still being 'open', so
// a second run sweeps nothing, two callers cannot both claim one window, and a window
// filled between the read and the write is left alone.
//
// Scoped to the caller's practice: a clinician closing out their own queue, not a global
// job. A Vercel cron can call this per practice later; the transition logic does not change.

import { NextResponse } from "next/server";

import { recordAccessEvent } from "@/lib/analytics/tiger";
import { appendAuditEvent } from "@/lib/audit/chain";
import { getClinician } from "@/lib/clinic/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const now = new Date();

  const auth = await getClinician(await createClient());
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.error }, { status: auth.status });

  const db = createAdminClient();
  const practiceId = auth.clinician.practiceId;

  // RLS has no update policy on windows, so the service role does the write. The practice
  // filter is applied here instead, through the patient the window belongs to.
  const { data, error } = await db
    .from("windows")
    .select("id, closes_at, patients!inner(practice_id)")
    .eq("status", "open")
    .lt("closes_at", now.toISOString())
    .eq("patients.practice_id", practiceId);

  if (error) {
    console.error("[windows/sweep] could not load overdue windows", { cause: error.message });
    return NextResponse.json({ ok: false, reason: "sweep_failed" }, { status: 500 });
  }

  const overdue = (data ?? []) as unknown as { id: string; closes_at: string }[];
  const swept: string[] = [];

  for (const window of overdue) {
    const { data: claimed, error: updateError } = await db
      .from("windows")
      .update({ status: "missed" })
      .eq("id", window.id)
      .eq("status", "open")
      .select("id");

    // Lost the race, or it was filled in the meantime. Either way it is not missed.
    if (updateError || !claimed || (claimed as unknown[]).length === 0) continue;
    swept.push(window.id);

    // A window is missed because time passed, not because a person did something, so the
    // actor is the system even though a clinician triggered the sweep.
    await appendAuditEvent(
      db,
      { actor: "system", action: "window.missed", refId: window.id, payload: { closed_at: window.closes_at } },
      now,
    );

    // The transition is already saved; analytics must not be able to undo it. Same guard
    // as app/api/reviews/route.ts and app/api/windows/fill/route.ts.
    try {
      // No days_to_fill: the prescription was never picked up, so there is nothing to time.
      await recordAccessEvent({ practiceId, event: "missed", time: now });
    } catch (err) {
      console.error("[windows/sweep] access event not recorded", {
        windowId: window.id,
        cause: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({ ok: true, swept: swept.length, windowIds: swept });
}
