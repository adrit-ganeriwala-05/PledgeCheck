// Recompute the audit hash chain from seq 1 and report the first break.
//
// Reasons:
//   missing_row    seq is not contiguous from 1 (firstBrokenSeq = the missing seq)
//   duplicate_seq  the same seq appears twice (cannot happen with the primary key; defensive)
//   broken_link    prev_hash differs from the previous row's recomputed hash
//   hash_mismatch  stored hash differs from the recomputed hash
//
// Computation continues past the first break so hashesBySeq always holds the recomputed
// hash of every row present, each chained onto the previous present row's recomputed hash.
// The verifier compares these, not the stored hashes, against on-chain anchors: an insider
// who edits a row and rewrites every later hash gets an "intact" chain here but a
// recomputed head that disagrees with Solana.
import { type AuditRow, computeHash, GENESIS_PREV_HASH } from "./hash";

export type ChainBreakReason = "missing_row" | "duplicate_seq" | "broken_link" | "hash_mismatch";

export type ChainVerification = {
  intact: boolean;
  checkedRows: number;
  firstBrokenSeq: number | null;
  reason: ChainBreakReason | null;
  hashesBySeq: Map<number, string>;
};

export function verifyChain(rows: AuditRow[]): ChainVerification {
  const sorted = [...rows].sort((a, b) => Number(a.seq) - Number(b.seq));
  const hashesBySeq = new Map<number, string>();

  let firstBrokenSeq: number | null = null;
  let reason: ChainBreakReason | null = null;
  const flag = (seq: number, why: ChainBreakReason) => {
    if (firstBrokenSeq === null) {
      firstBrokenSeq = seq;
      reason = why;
    }
  };

  let expectedSeq = 1;
  let prevRecomputed = GENESIS_PREV_HASH;

  for (const row of sorted) {
    const seq = Number(row.seq);

    if (seq < expectedSeq) {
      flag(seq, "duplicate_seq");
      continue;
    }
    if (seq > expectedSeq) flag(expectedSeq, "missing_row");

    if (row.prev_hash !== prevRecomputed) flag(seq, "broken_link");

    const recomputed = computeHash(prevRecomputed, row);
    if (row.hash !== recomputed) flag(seq, "hash_mismatch");

    hashesBySeq.set(seq, recomputed);
    prevRecomputed = recomputed;
    expectedSeq = seq + 1;
  }

  return {
    intact: firstBrokenSeq === null,
    checkedRows: sorted.length,
    firstBrokenSeq,
    reason,
    hashesBySeq,
  };
}
