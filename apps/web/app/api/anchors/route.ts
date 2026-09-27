// POST /api/anchors — anchor the current audit chain head on Solana devnet.
// Owner: Nihalika. Any signed-in clinician (prescriber or staff).
// 200 → { signature, explorerUrl, headSeq, headHash, reused }. signature and explorerUrl
// are the PRD contract; the rest are additions. An unchanged head returns the existing
// anchor with reused: true and sends no transaction.
import { NextResponse } from "next/server";

import { AnchorRecordError, anchorNow, NothingToAnchorError } from "@/lib/audit/anchor";
import { SolanaConfigError, SolanaFundsError, SolanaRpcError } from "@/lib/audit/solana";
import { getClinician } from "@/lib/clinic/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Covers the 30 s confirmation cap plus the database reads and insert.
export const maxDuration = 60;

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST() {
  const supabase = await createClient();
  const auth = await getClinician(supabase);
  if (!auth.ok) return fail(auth.status, auth.error);

  try {
    return NextResponse.json(await anchorNow());
  } catch (err) {
    if (err instanceof NothingToAnchorError) return fail(409, "nothing_to_anchor");
    if (err instanceof SolanaConfigError) {
      console.error("[anchors] Solana is not configured", { reason: err.reason });
      return fail(500, "solana_not_configured");
    }
    if (err instanceof SolanaFundsError) return fail(502, "wallet_needs_devnet_sol");
    if (err instanceof SolanaRpcError) return fail(502, "solana_unavailable");
    if (err instanceof AnchorRecordError) {
      return fail(500, "anchor_not_recorded", { signature: err.signature, explorerUrl: err.explorerUrl });
    }
    console.error("[anchors] anchor failed", { error: err instanceof Error ? err.name : "unknown" });
    return fail(500, "anchor_failed");
  }
}
