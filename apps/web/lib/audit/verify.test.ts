import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRow } from "./hash";
import { buildMemo } from "./memo";
import { SolanaConfigError, SolanaRpcError } from "./solana";
import { buildChain, editPayload, sophisticatedInsider } from "./testing/chain";

const mocks = vi.hoisted(() => ({
  fetchMemo: vi.fn(),
  anchorPublicKey: vi.fn(),
}));
vi.mock("./solana", async (importOriginal) => {
  const real = await importOriginal<typeof import("./solana")>();
  return { ...real, fetchMemo: mocks.fetchMemo, anchorPublicKey: mocks.anchorPublicKey };
});

const { verifyAudit, PAGE_SIZE } = await import("./verify");

const OUR_KEY = "OurAnchorWallet1111111111111111111111111111"; // test vector, not a real key
const OTHER_KEY = "SomeoneElse11111111111111111111111111111111"; // test vector

type Anchor = { head_seq: number; head_hash: string; solana_signature: string; created_at: string };

// Minimal query double: audit_events honours .range(); anchors returns the list as given
// (tests pass it newest first, as the query orders it).
function fakeDb(rows: AuditRow[], anchors: Anchor[]) {
  const ranges: Array<[number, number]> = [];
  const from = (table: string) => {
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "not", "limit"]) builder[m] = () => builder;
    builder.range = (a: number, b: number) => {
      range = [a, b];
      ranges.push(range);
      return builder;
    };
    builder.then = (resolve: (r: unknown) => unknown) => {
      if (table === "anchors") return Promise.resolve({ data: anchors, error: null }).then(resolve);
      const data = range ? rows.slice(range[0], range[1] + 1) : rows;
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return builder;
  };
  // Only the query-builder surface verifyAudit uses.
  return { db: { from } as unknown as Parameters<typeof verifyAudit>[0], ranges };
}

const sigFor = (seq: number) => `sig${seq}x`.padEnd(88, "1"); // test vector; "x" keeps sig1 and sig11 distinct

function anchorAt(chain: AuditRow[], seq: number, minute = seq): Anchor {
  return {
    head_seq: seq,
    head_hash: chain[seq - 1].hash,
    solana_signature: sigFor(seq),
    created_at: new Date(Date.parse("2026-09-26T20:00:00Z") + minute * 60_000).toISOString(),
  };
}

// On-chain state: signature -> memo text + fee payer.
let onChain: Map<string, { memoText: string | null; feePayer: string }>;
function publish(anchor: Anchor, opts: { hash?: string; seq?: number; payer?: string; memoText?: string | null } = {}) {
  onChain.set(anchor.solana_signature, {
    memoText: opts.memoText !== undefined ? opts.memoText : buildMemo(opts.seq ?? anchor.head_seq, opts.hash ?? anchor.head_hash),
    feePayer: opts.payer ?? OUR_KEY,
  });
}

beforeEach(() => {
  onChain = new Map();
  mocks.anchorPublicKey.mockReset().mockReturnValue(OUR_KEY);
  mocks.fetchMemo.mockReset().mockImplementation(async (sig: string) => {
    const tx = onChain.get(sig);
    return tx ? { ...tx, blockTime: 1_790_000_000 } : null;
  });
});

describe("verifyAudit", () => {
  it("intact chain plus a matching anchor is intact", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    publish(a);
    const r = await verifyAudit(fakeDb(chain, [a]).db);
    expect(r).toMatchObject({
      ok: true,
      status: "intact",
      reason: null,
      headSeq: 20,
      headHash: chain[19].hash,
      anchoredHash: chain[19].hash,
      match: true,
      firstBrokenSeq: null,
      checkedRows: 25,
      unanchoredCount: 5,
      dbCopyMatches: true,
      anchor: { signature: a.solana_signature, explorerUrl: `https://explorer.solana.com/tx/${a.solana_signature}?cluster=devnet` },
    });
    expect(r.anchorsChecked).toEqual([
      { headSeq: 20, match: true, status: "intact", reason: null, explorerUrl: expect.stringContaining(a.solana_signature) },
    ]);
  });

  it("an edited payload is tampered at that seq", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    publish(a);
    const r = await verifyAudit(fakeDb(editPayload(chain, 17, { decision: "rejected" }), [a]).db);
    expect(r).toMatchObject({ ok: false, status: "tampered", reason: "hash_mismatch", firstBrokenSeq: 17, match: false });
  });

  it("sophisticated insider: stored chain intact, but Solana disagrees", async () => {
    const chain = buildChain(25);
    const old = anchorAt(chain, 10);
    const a = anchorAt(chain, 20);
    publish(old);
    publish(a);
    const r = await verifyAudit(fakeDb(sophisticatedInsider(chain, 17), [a, old]).db);
    expect(r).toMatchObject({
      ok: false,
      status: "tampered",
      reason: "anchor_mismatch",
      firstBrokenSeq: null,
      match: false,
      headSeq: 20,
      anchoredHash: chain[19].hash,
      tamperedWithin: { fromSeq: 11, toSeq: 20 },
    });
    expect(r.headHash).not.toBe(chain[19].hash);
    expect(r.anchorsChecked.map((c) => [c.headSeq, c.status])).toEqual([
      [20, "tampered"],
      [10, "intact"],
    ]);
  });

  it("a memo from another wallet is unverifiable, even if its hash would match", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    publish(a, { payer: OTHER_KEY });
    const r = await verifyAudit(fakeDb(chain, [a]).db);
    expect(r).toMatchObject({ ok: false, status: "unverifiable", reason: "wrong_fee_payer", anchoredHash: null, match: false });
  });

  it("RPC down is unverifiable, never tampered — even over a rewritten chain", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    mocks.fetchMemo.mockRejectedValue(new SolanaRpcError("down"));
    for (const rows of [chain, sophisticatedInsider(chain, 17)]) {
      const r = await verifyAudit(fakeDb(rows, [a]).db);
      expect(r).toMatchObject({ ok: false, status: "unverifiable", reason: "solana_unreachable", dbCopyMatches: null });
    }
  });

  it("Solana not configured is unverifiable without calling the RPC", async () => {
    const chain = buildChain(5);
    mocks.anchorPublicKey.mockImplementation(() => {
      throw new SolanaConfigError("not_configured");
    });
    const r = await verifyAudit(fakeDb(chain, [anchorAt(chain, 5)]).db);
    expect(r).toMatchObject({ status: "unverifiable", reason: "solana_not_configured" });
    expect(mocks.fetchMemo).not.toHaveBeenCalled();
  });

  it.each([
    ["transaction not found", () => {}, "anchor_tx_not_found"],
    ["malformed memo", (a: Anchor) => publish(a, { memoText: "hello" }), "memo_missing_or_malformed"],
    ["no memo", (a: Anchor) => publish(a, { memoText: null }), "memo_missing_or_malformed"],
    ["memo for another seq", (a: Anchor) => publish(a, { seq: 19 }), "memo_seq_mismatch"],
  ])("%s is unverifiable", async (_label, arrange, reason) => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    arrange(a);
    expect(await verifyAudit(fakeDb(chain, [a]).db)).toMatchObject({ status: "unverifiable", reason });
  });

  it("a proven anchor for a row that no longer exists is tampered", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 25);
    publish(a);
    const r = await verifyAudit(fakeDb(chain.slice(0, 22), [a]).db);
    expect(r).toMatchObject({ status: "tampered", reason: "anchored_row_missing", firstBrokenSeq: null });
  });

  it("tampered wins over unverifiable when both occur", async () => {
    const chain = buildChain(25);
    const old = anchorAt(chain, 10);
    const a = anchorAt(chain, 20);
    publish(a); // old anchor's transaction is missing
    const r = await verifyAudit(fakeDb(sophisticatedInsider(chain, 17), [a, old]).db);
    expect(r).toMatchObject({ status: "tampered", reason: "anchor_mismatch", tamperedWithin: { fromSeq: 1, toSeq: 20 } });
  });

  it("no anchors is no_anchor; an empty log too", async () => {
    const chain = buildChain(25);
    expect(await verifyAudit(fakeDb(chain, []).db)).toMatchObject({
      ok: false,
      status: "no_anchor",
      headSeq: null,
      headHash: null,
      anchoredHash: null,
      match: false,
      unanchoredCount: 25,
      dbCopyMatches: null,
      anchor: null,
      anchorsChecked: [],
    });
    expect(await verifyAudit(fakeDb([], []).db)).toMatchObject({ status: "no_anchor", checkedRows: 0, unanchoredCount: 0 });
    expect(mocks.anchorPublicKey).not.toHaveBeenCalled();
  });

  it("a broken chain is tampered even before the first anchor", async () => {
    const chain = editPayload(buildChain(5), 3, { decision: "rejected" });
    expect(await verifyAudit(fakeDb(chain, []).db)).toMatchObject({ status: "tampered", firstBrokenSeq: 3 });
  });

  it("an edited DB copy of the anchor is reported, but the on-chain value decides", async () => {
    const chain = buildChain(25);
    const a = anchorAt(chain, 20);
    publish(a);
    const edited = { ...a, head_hash: "f".repeat(64) }; // test vector
    const r = await verifyAudit(fakeDb(chain, [edited]).db);
    expect(r).toMatchObject({ status: "intact", ok: true, match: true, dbCopyMatches: false });
  });

  it("reads audit rows in pages of 1000", async () => {
    const chain = buildChain(2 * PAGE_SIZE + 5);
    const a = anchorAt(chain, 2 * PAGE_SIZE + 5);
    publish(a);
    const { db, ranges } = fakeDb(chain, [a]);
    const r = await verifyAudit(db);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(r).toMatchObject({ status: "intact", checkedRows: 2 * PAGE_SIZE + 5 });
  });

  it("stops paging after an exactly full last page", async () => {
    const { db, ranges } = fakeDb(buildChain(PAGE_SIZE), []);
    expect((await verifyAudit(db)).checkedRows).toBe(PAGE_SIZE);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("fetches at most 5 anchor transactions at a time", async () => {
    const chain = buildChain(20);
    const anchors = Array.from({ length: 20 }, (_, i) => anchorAt(chain, 20 - i));
    anchors.forEach((a) => publish(a));
    let inFlight = 0;
    let peak = 0;
    mocks.fetchMemo.mockImplementation(async (sig: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { ...onChain.get(sig)!, blockTime: 1 };
    });
    const r = await verifyAudit(fakeDb(chain, anchors).db);
    expect(r.status).toBe("intact");
    expect(r.anchorsChecked).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(5);
    expect(mocks.fetchMemo).toHaveBeenCalledWith(expect.any(String), { timeoutMs: 10_000 });
  });
});
