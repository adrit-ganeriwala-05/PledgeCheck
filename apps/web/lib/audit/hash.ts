// Audit hash chain specification (v1). The writer (append.ts), the verifier
// (verify-chain.ts) and any independent re-implementation must follow it exactly.
//
//   hash(row) = lowercase_hex( sha256( prev_hash || canonicalJson(fields) ) )
//
//   prev_hash  the previous row's hash; for seq = 1 it is GENESIS_PREV_HASH (64 zeros).
//              Concatenated as its 64-character ASCII hex string, not as raw bytes.
//   fields     exactly { seq, actor, action, ref_id, payload, created_at }, where
//                seq         JSON integer
//                actor       string
//                action      string
//                ref_id      uuid string, or null
//                payload     the jsonb object ({} when absent)
//                created_at  ISO 8601 UTC with millisecond precision and "Z",
//                            i.e. new Date(t).toISOString(); Postgres "+00:00" output
//                            normalizes to the same string
//   canonicalJson  see canonical.ts: keys sorted, no whitespace, integers only.
//
// The stored prev_hash and hash columns are not part of the hashed fields.
import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical";

export const GENESIS_PREV_HASH = "0".repeat(64);

export type AuditRow = {
  seq: number | string;
  actor: string;
  action: string;
  ref_id: string | null;
  payload: unknown;
  created_at: string | Date;
  prev_hash: string | null;
  hash: string;
};

export type HashInput = Pick<AuditRow, "seq" | "actor" | "action" | "ref_id" | "payload" | "created_at">;

export type HashedFields = {
  seq: number;
  actor: string;
  action: string;
  ref_id: string | null;
  payload: unknown;
  created_at: string;
};

export function normalizeTimestamp(t: string | Date): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error("normalizeTimestamp: invalid timestamp");
  return d.toISOString();
}

export function hashedFields(row: HashInput): HashedFields {
  const seq = Number(row.seq);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("hashedFields: invalid seq");
  return {
    seq,
    actor: row.actor,
    action: row.action,
    ref_id: row.ref_id == null ? null : String(row.ref_id),
    payload: row.payload ?? {},
    created_at: normalizeTimestamp(row.created_at),
  };
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeHash(prevHash: string, row: HashInput): string {
  return sha256Hex(prevHash + canonicalJson(hashedFields(row)));
}
