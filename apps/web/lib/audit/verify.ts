// Verify the audit log against its Solana anchors. Server-only.
//
// 1. Load every audit row (pages of 1000) and recompute the chain (verify-chain.ts).
// 2. Load the newest 20 anchors. For each, read the memo back from Solana and compare it
//    with the RECOMPUTED hash at that seq. The on-chain memo is the source of truth;
//    anchors.head_hash is only a database copy and is reported separately.
// 3. Status:
//      tampered      the stored chain is broken, or a recomputed hash differs from the
//                    hash on-chain (an insider who rewrote every later hash)
//      unverifiable  an anchor could not be checked (RPC down, transaction or memo missing
//                    or malformed, wrong fee payer, Solana not configured) and nothing
//                    else proves tampering. Unreachable Solana is never "tampered".
//      no_anchor     chain intact but nothing anchored yet
//      intact        chain intact and every checked anchor matches on-chain
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

import type { AuditRow } from "./hash";
import { parseMemo } from "./memo";
import { anchorPublicKey, explorerUrl, fetchMemo, SolanaConfigError } from "./solana";
import { type ChainBreakReason, verifyChain } from "./verify-chain";

export const PAGE_SIZE = 1000;
export const MAX_ANCHORS_CHECKED = 20;
const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;

export type VerifyStatus = "intact" | "tampered" | "unverifiable" | "no_anchor";

export type AnchorCheckReason =
  | "anchor_mismatch"
  | "anchored_row_missing"
  | "solana_not_configured"
  | "solana_unreachable"
  | "anchor_tx_not_found"
  | "wrong_fee_payer"
  | "memo_missing_or_malformed"
  | "memo_seq_mismatch";

export type VerifyReason = ChainBreakReason | AnchorCheckReason;

export type AnchorCheck = {
  headSeq: number;
  match: boolean;
  status: "intact" | "tampered" | "unverifiable";
  reason: AnchorCheckReason | null;
  explorerUrl: string;
  signature: string;
  anchoredAt: string;
  recomputedHash: string | null;
  onChainHash: string | null;
  dbCopyMatches: boolean | null;
};

export type VerifyResult = {
  ok: boolean;
  headSeq: number | null;
  headHash: string | null;
  anchoredHash: string | null;
  match: boolean;
  status: VerifyStatus;
  reason: VerifyReason | null;
  firstBrokenSeq: number | null;
  // For an anchor mismatch with an intact stored chain, the edited row lies in this range.
  tamperedWithin: { fromSeq: number; toSeq: number } | null;
  checkedRows: number;
  unanchoredCount: number;
  dbCopyMatches: boolean | null;
  anchor: { signature: string; explorerUrl: string; anchoredAt: string } | null;
  anchorsChecked: Array<Pick<AnchorCheck, "headSeq" | "match" | "status" | "reason" | "explorerUrl">>;
};

export class VerifyDbError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VerifyDbError";
  }
}

type Db = SupabaseClient<Database>;
type AnchorRow = { head_seq: number; head_hash: string; solana_signature: string; created_at: string };

export async function loadAuditRows(db: Db): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("audit_events")
      .select("seq, actor, action, ref_id, payload, created_at, prev_hash, hash")
      .order("seq", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new VerifyDbError("could not read audit_events", { cause: error });
    rows.push(...((data ?? []) as AuditRow[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function loadAnchors(db: Db): Promise<AnchorRow[]> {
  const { data, error } = await db
    .from("anchors")
    .select("head_seq, head_hash, solana_signature, created_at")
    .not("solana_signature", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ANCHORS_CHECKED);
  if (error) throw new VerifyDbError("could not read anchors", { cause: error });
  return ((data ?? []) as AnchorRow[]).map((a) => ({ ...a, head_seq: Number(a.head_seq) }));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function checkAnchor(
  anchor: AnchorRow,
  recomputed: string | undefined,
  ourKey: string | null,
): Promise<AnchorCheck> {
  const base = {
    headSeq: anchor.head_seq,
    explorerUrl: explorerUrl(anchor.solana_signature),
    signature: anchor.solana_signature,
    anchoredAt: new Date(anchor.created_at).toISOString(),
    recomputedHash: recomputed ?? null,
  };
  const result = (
    status: AnchorCheck["status"],
    reason: AnchorCheckReason | null,
    onChainHash: string | null = null,
  ): AnchorCheck => ({
    ...base,
    status,
    reason,
    onChainHash,
    match: status === "intact",
    dbCopyMatches: onChainHash === null ? null : anchor.head_hash === onChainHash,
  });

  if (!ourKey) return result("unverifiable", "solana_not_configured");

  let fetched: Awaited<ReturnType<typeof fetchMemo>>;
  try {
    fetched = await fetchMemo(anchor.solana_signature, { timeoutMs: FETCH_TIMEOUT_MS });
  } catch (err) {
    return result("unverifiable", err instanceof SolanaConfigError ? "solana_not_configured" : "solana_unreachable");
  }
  if (!fetched) return result("unverifiable", "anchor_tx_not_found");
  // A memo paid for by any other wallet proves nothing.
  if (fetched.feePayer !== ourKey) return result("unverifiable", "wrong_fee_payer");
  const memo = fetched.memoText === null ? null : parseMemo(fetched.memoText);
  if (!memo) return result("unverifiable", "memo_missing_or_malformed");
  if (memo.headSeq !== anchor.head_seq) return result("unverifiable", "memo_seq_mismatch", memo.headHash);

  if (recomputed === undefined) return result("tampered", "anchored_row_missing", memo.headHash);
  if (recomputed !== memo.headHash) return result("tampered", "anchor_mismatch", memo.headHash);
  return result("intact", null, memo.headHash);
}

export async function verifyAudit(db: Db): Promise<VerifyResult> {
  const rows = await loadAuditRows(db);
  const chain = verifyChain(rows);
  const anchors = await loadAnchors(db);

  let ourKey: string | null = null;
  if (anchors.length > 0) {
    try {
      ourKey = anchorPublicKey();
    } catch (err) {
      if (!(err instanceof SolanaConfigError)) throw err;
    }
  }

  const checks = await mapLimit(anchors, FETCH_CONCURRENCY, (a) =>
    checkAnchor(a, chain.hashesBySeq.get(a.head_seq), ourKey),
  );

  const latestSeq = rows.reduce((max, r) => Math.max(max, Number(r.seq)), 0);
  const latest = checks[0] ?? null;
  const highestAnchored = anchors.length ? Math.max(...anchors.map((a) => a.head_seq)) : 0;

  // checks are newest-first; the reported reason is the lowest-seq anchor that failed.
  const bySeq = [...checks].sort((a, b) => a.headSeq - b.headSeq);
  const firstTampered = bySeq.find((c) => c.status === "tampered") ?? null;
  const firstUnverifiable = bySeq.find((c) => c.status === "unverifiable") ?? null;

  let status: VerifyStatus;
  let reason: VerifyReason | null = null;
  if (!chain.intact) {
    status = "tampered";
    reason = chain.reason;
  } else if (firstTampered) {
    status = "tampered";
    reason = firstTampered.reason;
  } else if (checks.length === 0) {
    status = "no_anchor";
  } else if (firstUnverifiable) {
    status = "unverifiable";
    reason = firstUnverifiable.reason;
  } else {
    status = "intact";
  }

  let tamperedWithin: VerifyResult["tamperedWithin"] = null;
  if (firstTampered) {
    const lastGood = bySeq.filter((c) => c.status === "intact" && c.headSeq < firstTampered.headSeq).at(-1);
    tamperedWithin = { fromSeq: lastGood ? lastGood.headSeq + 1 : 1, toSeq: firstTampered.headSeq };
  }

  const dbCopies = checks.map((c) => c.dbCopyMatches).filter((m): m is boolean => m !== null);
  const headHash = latest?.recomputedHash ?? null;
  const anchoredHash = latest?.onChainHash ?? null;

  return {
    ok: status === "intact",
    headSeq: latest?.headSeq ?? null,
    headHash,
    anchoredHash,
    match: headHash !== null && headHash === anchoredHash,
    status,
    reason,
    firstBrokenSeq: chain.firstBrokenSeq,
    tamperedWithin,
    checkedRows: chain.checkedRows,
    unanchoredCount: Math.max(0, latestSeq - highestAnchored),
    dbCopyMatches: dbCopies.length === 0 ? null : dbCopies.every(Boolean),
    anchor: latest ? { signature: latest.signature, explorerUrl: latest.explorerUrl, anchoredAt: latest.anchoredAt } : null,
    anchorsChecked: checks.map(({ headSeq, match, status, reason, explorerUrl }) => ({
      headSeq,
      match,
      status,
      reason,
      explorerUrl,
    })),
  };
}
