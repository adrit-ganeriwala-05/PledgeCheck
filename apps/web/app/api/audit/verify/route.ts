// GET /api/audit/verify — recompute the audit chain and check it against Solana anchors.
// Owner: Nihalika. Any signed-in clinician. Reads run as the clinician (RLS allows every
// clinician to read audit_events and anchors); no service role is needed.
// 200 → VerifyResult (lib/audit/verify.ts). "unverifiable" is never reported as "tampered".
import { NextResponse } from "next/server";

import { verifyAudit } from "@/lib/audit/verify";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 20 anchor lookups, 5 at a time, each capped at 10 s.
export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await verifyAudit(supabase));
  } catch (err) {
    console.error("[audit/verify] verification failed", { error: err instanceof Error ? err.name : "unknown" });
    return NextResponse.json({ error: "verify_failed" }, { status: 500 });
  }
}
