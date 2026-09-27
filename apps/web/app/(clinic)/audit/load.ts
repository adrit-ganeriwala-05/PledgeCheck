// Data for /audit, read as the signed-in clinician. RLS lets every clinician read
// audit_events and anchors; nothing here needs the service role.
import "server-only";

import type { AnchorItem, ChainPage, ChainRow } from "@/components/audit/types";
import { explorerUrl } from "@/lib/audit/solana";
import type { createClient } from "@/lib/supabase/server";

export const ROWS_PER_PAGE = 50;
export const ANCHORS_SHOWN = 20;

type Db = Awaited<ReturnType<typeof createClient>>;

// Page (1-based, newest first) that holds `seq`: rows newer than it, divided by page size.
export async function pageForSeq(db: Db, seq: number): Promise<number> {
  const { count, error } = await db.from("audit_events").select("seq", { count: "exact", head: true }).gt("seq", seq);
  if (error) throw new Error("could not locate audit row");
  return Math.floor((count ?? 0) / ROWS_PER_PAGE) + 1;
}

export async function loadChainPage(db: Db, requestedPage: number): Promise<ChainPage> {
  const { count, error: countError } = await db.from("audit_events").select("seq", { count: "exact", head: true });
  if (countError) throw new Error("could not count audit events");
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  if (total === 0) return { rows: [], page: 1, pageCount: 1, total: 0 };

  const from = (page - 1) * ROWS_PER_PAGE;
  const { data, error } = await db
    .from("audit_events")
    .select("seq, created_at, actor, action, ref_id, prev_hash, hash")
    .order("seq", { ascending: false })
    .range(from, from + ROWS_PER_PAGE - 1);
  if (error) throw new Error("could not load audit events");

  const rows: ChainRow[] = (data ?? []).map((r) => ({
    seq: Number(r.seq),
    createdAt: new Date(r.created_at).toISOString(),
    actor: r.actor,
    action: r.action,
    refId: r.ref_id,
    prevHash: r.prev_hash,
    hash: r.hash,
  }));
  return { rows, page, pageCount, total };
}

export async function loadAnchors(db: Db): Promise<AnchorItem[]> {
  const { data, error } = await db
    .from("anchors")
    .select("head_seq, head_hash, solana_signature, created_at")
    .not("solana_signature", "is", null)
    .order("created_at", { ascending: false })
    .limit(ANCHORS_SHOWN);
  if (error) throw new Error("could not load anchors");
  return (data ?? []).flatMap((a) =>
    a.solana_signature
      ? [
          {
            headSeq: Number(a.head_seq),
            headHash: a.head_hash,
            signature: a.solana_signature,
            explorerUrl: explorerUrl(a.solana_signature),
            anchoredAt: new Date(a.created_at).toISOString(),
          },
        ]
      : [],
  );
}

export async function loadLatestSeq(db: Db): Promise<number> {
  const { data, error } = await db.from("audit_events").select("seq").order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("could not read audit head");
  return data ? Number(data.seq) : 0;
}
