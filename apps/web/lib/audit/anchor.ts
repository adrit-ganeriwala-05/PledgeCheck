// Anchor the audit chain head on Solana devnet. Server-only: uses the service role.
//
// Only `pledgecheck:v1:<headSeq>:<headHash>` goes on-chain (see memo.ts). Anchoring is not
// an audit event; each anchor is a row in `anchors`.
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildMemo } from "./memo";
import { explorerUrl, sendMemo, SOLANA_CLUSTER } from "./solana";

export class NothingToAnchorError extends Error {
  constructor() {
    super("The audit log is empty; there is nothing to anchor");
    this.name = "NothingToAnchorError";
  }
}

// The memo transaction confirmed but its `anchors` row was not written. The signature is
// carried so it can be recorded by hand.
export class AnchorRecordError extends Error {
  readonly explorerUrl: string;
  constructor(
    readonly signature: string,
    readonly headSeq: number,
    readonly headHash: string,
    options?: { cause?: unknown },
  ) {
    super(`Anchor transaction ${signature} confirmed but was not recorded`, options);
    this.name = "AnchorRecordError";
    this.explorerUrl = explorerUrl(signature);
  }
}

export class AnchorDbError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnchorDbError";
  }
}

export type ChainHead = { seq: number; hash: string };

export type LatestAnchor = {
  headSeq: number;
  headHash: string;
  signature: string;
  explorerUrl: string;
  cluster: string;
  anchoredAt: string;
};

export type AnchorResult = {
  signature: string;
  explorerUrl: string;
  headSeq: number;
  headHash: string;
  reused: boolean;
};

export async function getHead(): Promise<ChainHead | null> {
  const { data, error } = await createAdminClient()
    .from("audit_events")
    .select("seq, hash")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AnchorDbError("could not read audit head", { cause: error });
  return data ? { seq: Number(data.seq), hash: data.hash } : null;
}

// The most recent anchor with a transaction signature. Exported for the audit PDF (A7).
export async function getLatestAnchor(): Promise<LatestAnchor | null> {
  const { data, error } = await createAdminClient()
    .from("anchors")
    .select("head_seq, head_hash, solana_signature, cluster, created_at")
    .not("solana_signature", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AnchorDbError("could not read anchors", { cause: error });
  if (!data || !data.solana_signature) return null;
  return {
    headSeq: Number(data.head_seq),
    headHash: data.head_hash,
    signature: data.solana_signature,
    explorerUrl: explorerUrl(data.solana_signature),
    cluster: data.cluster,
    anchoredAt: new Date(data.created_at).toISOString(),
  };
}

// Anchors the current head. Idempotent: an unchanged head returns the existing anchor
// with reused: true and sends nothing.
export async function anchorNow(): Promise<AnchorResult> {
  const head = await getHead();
  if (!head) throw new NothingToAnchorError();

  const latest = await getLatestAnchor();
  if (latest && latest.headSeq === head.seq && latest.headHash === head.hash) {
    return {
      signature: latest.signature,
      explorerUrl: latest.explorerUrl,
      headSeq: head.seq,
      headHash: head.hash,
      reused: true,
    };
  }

  const signature = await sendMemo(buildMemo(head.seq, head.hash));

  const { error } = await createAdminClient().from("anchors").insert({
    head_seq: head.seq,
    head_hash: head.hash,
    solana_signature: signature,
    cluster: SOLANA_CLUSTER,
  });
  if (error) {
    console.error("[anchor] ANCHOR NOT RECORDED — transaction confirmed; insert this row by hand", {
      signature,
      headSeq: head.seq,
      headHash: head.hash,
      code: error.code,
    });
    throw new AnchorRecordError(signature, head.seq, head.hash, { cause: error });
  }

  return { signature, explorerUrl: explorerUrl(signature), headSeq: head.seq, headHash: head.hash, reused: false };
}
