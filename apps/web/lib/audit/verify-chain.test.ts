import { describe, expect, it } from "vitest";

import { GENESIS_PREV_HASH } from "./hash";
import { buildChain, editPayload, sophisticatedInsider } from "./testing/chain";
import { verifyChain } from "./verify-chain";

describe("verifyChain", () => {
  it("passes an intact chain of 25 rows", () => {
    const rows = buildChain(25);
    const result = verifyChain(rows);
    expect(result).toMatchObject({ intact: true, checkedRows: 25, firstBrokenSeq: null, reason: null });
    expect(result.hashesBySeq.size).toBe(25);
    expect(result.hashesBySeq.get(25)).toBe(rows[24].hash);
    expect(rows[0].prev_hash).toBe(GENESIS_PREV_HASH);
  });

  it("treats an empty log as intact", () => {
    expect(verifyChain([])).toMatchObject({ intact: true, checkedRows: 0, firstBrokenSeq: null });
  });

  it("does not depend on input order", () => {
    const rows = buildChain(10).reverse();
    expect(verifyChain(rows).intact).toBe(true);
  });

  it("accepts Postgres-formatted timestamps and string seqs", () => {
    const rows = buildChain(5).map((r) => ({
      ...r,
      seq: String(r.seq),
      created_at: String(r.created_at).replace("Z", "+00:00"),
    }));
    expect(verifyChain(rows).intact).toBe(true);
  });

  it("reports hash_mismatch at an edited payload", () => {
    const rows = editPayload(buildChain(25), 17, { decision: "rejected", n: 17 });
    const result = verifyChain(rows);
    expect(result).toMatchObject({ intact: false, firstBrokenSeq: 17, reason: "hash_mismatch" });
    // Computation continues past the break.
    expect(result.hashesBySeq.size).toBe(25);
  });

  it("reports missing_row for a deleted row", () => {
    const rows = buildChain(25).filter((r) => r.seq !== 10);
    expect(verifyChain(rows)).toMatchObject({ intact: false, firstBrokenSeq: 10, reason: "missing_row" });
  });

  it("reports missing_row when seq 1 is deleted", () => {
    const rows = buildChain(5).slice(1);
    expect(verifyChain(rows)).toMatchObject({ intact: false, firstBrokenSeq: 1, reason: "missing_row" });
  });

  it("reports broken_link for swapped rows", () => {
    const rows = buildChain(25).map((r) => ({ ...r }));
    rows[4].seq = 6;
    rows[5].seq = 5;
    expect(verifyChain(rows)).toMatchObject({ intact: false, firstBrokenSeq: 5, reason: "broken_link" });
  });

  it("reports broken_link for a wrong prev_hash on seq 1", () => {
    const rows = buildChain(3).map((r) => ({ ...r }));
    rows[0].prev_hash = "f".repeat(64);
    expect(verifyChain(rows)).toMatchObject({ firstBrokenSeq: 1, reason: "broken_link" });
  });

  it("reports duplicate_seq", () => {
    const rows = buildChain(5);
    expect(verifyChain([...rows, { ...rows[2] }])).toMatchObject({
      intact: false,
      firstBrokenSeq: 3,
      reason: "duplicate_seq",
    });
  });

  it("sophisticated insider: chain looks intact, but the recomputed head moves", () => {
    const original = verifyChain(buildChain(25)).hashesBySeq;
    const anchoredHead = original.get(25);

    const result = verifyChain(sophisticatedInsider(buildChain(25), 17));

    expect(result.intact).toBe(true);
    expect(result.hashesBySeq.get(16)).toBe(original.get(16));
    expect(result.hashesBySeq.get(17)).not.toBe(original.get(17));
    expect(result.hashesBySeq.get(25)).not.toBe(anchoredHead);
  });
});
