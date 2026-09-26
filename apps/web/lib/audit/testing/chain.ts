// Test fixtures: build a valid audit chain and tamper with it. Used by audit tests only.
import { type AuditRow, computeHash, GENESIS_PREV_HASH } from "../hash";

const BASE_TIME = Date.parse("2026-09-26T14:00:00.000Z");

export function buildChain(length: number): AuditRow[] {
  const rows: AuditRow[] = [];
  let prev = GENESIS_PREV_HASH;
  for (let seq = 1; seq <= length; seq++) {
    const row = {
      seq,
      actor: seq % 3 === 0 ? "system" : "clinician:a0000000-0000-0000-0000-000000000001",
      action: seq % 2 === 0 ? "review.approved" : "submission.received",
      ref_id: `a3000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
      payload: { decision: "approved", n: seq },
      created_at: new Date(BASE_TIME + seq * 60_000).toISOString(),
    };
    const hash = computeHash(prev, row);
    rows.push({ ...row, prev_hash: prev, hash });
    prev = hash;
  }
  return rows;
}

// Recompute prev_hash and hash for every row from `fromSeq` on, as an insider with
// database access would after editing a row.
export function rehashFrom(rows: AuditRow[], fromSeq: number): AuditRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    const seq = Number(out[i].seq);
    if (seq < fromSeq) continue;
    const prev = i === 0 ? GENESIS_PREV_HASH : out[i - 1].hash;
    out[i].prev_hash = prev;
    out[i].hash = computeHash(prev, out[i]);
  }
  return out;
}

export function editPayload(rows: AuditRow[], seq: number, payload: Record<string, unknown>): AuditRow[] {
  return rows.map((r) => (Number(r.seq) === seq ? { ...r, payload } : r));
}

// Edit one row, then rewrite every later hash so the stored chain looks valid.
export function sophisticatedInsider(rows: AuditRow[], seq: number): AuditRow[] {
  return rehashFrom(editPayload(rows, seq, { decision: "rejected", n: seq }), seq);
}
