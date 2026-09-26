// POST /api/windows/fill — the pharmacy stand-in. Owner: Labib (ticket L5).
//
// Marking a window filled is a clinic action, so it writes an audit event, and
// it is the moment we learn days_to_fill, so it also writes the de-identified
// Tiger Data event in the same request. No background sync.

import { NextResponse } from "next/server";

import { daysBetween, recordAccessEvent } from "@/lib/analytics/tiger";
import { appendAuditEvent } from "@/lib/audit/chain";
import { getClinician } from "@/lib/clinic/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const now = new Date();

  // Marking a window filled is a clinic action, so it needs a clinic session. RLS has no
  // update policy on windows, so the write itself goes through the service role below.
  const auth = await getClinician(await createClient());
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.error }, { status: auth.status });

  let body: { windowId?: string };
  try {
    body = (await request.json()) as { windowId?: string };
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid body" }, { status: 400 });
  }

  const windowId = body.windowId;
  if (!windowId) return NextResponse.json({ ok: false, reason: "missing windowId" }, { status: 400 });

  const db = createAdminClient();

  const { data: existing, error: loadError } = await db
    .from("windows")
    .select("id, patient_id, opens_at, closes_at, status, patients(practice_id)")
    .eq("id", windowId)
    .maybeSingle();

  if (loadError || !existing) {
    return NextResponse.json({ ok: false, reason: "window not found" }, { status: 404 });
  }

  const row = existing as unknown as {
    id: string;
    patient_id: string;
    opens_at: string;
    closes_at: string;
    status: "open" | "filled" | "missed";
    patients: { practice_id: string } | { practice_id: string }[] | null;
  };

  if (row.status === "filled") {
    return NextResponse.json({ ok: true, alreadyFilled: true });
  }

  // Only an open window can be filled; a missed one needs a repeat test first.
  const { data: updated, error: updateError } = await db
    .from("windows")
    .update({ filled_at: now.toISOString(), status: "filled" })
    .eq("id", windowId)
    .eq("status", "open")
    .select("id")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { ok: false, reason: "window is no longer open; a repeat test is needed" },
      { status: 409 },
    );
  }

  const practice = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  const daysToFill = daysBetween(new Date(row.opens_at), now);

  await appendAuditEvent(
    db,
    {
      actor: `clinician:${auth.clinician.id}`,
      action: "window.filled",
      refId: windowId,
      payload: { days_to_fill: daysToFill },
    },
    now,
  );

  if (practice?.practice_id) {
    await recordAccessEvent({
      practiceId: practice.practice_id,
      event: "filled",
      daysToFill,
      time: now,
    });
  }

  return NextResponse.json({ ok: true, daysToFill });
}
