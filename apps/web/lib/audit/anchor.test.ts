import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type Result } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  sendMemo: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("./solana", async (importOriginal) => {
  const real = await importOriginal<typeof import("./solana")>();
  return { ...real, sendMemo: mocks.sendMemo };
});

const { anchorNow, getLatestAnchor, AnchorRecordError, NothingToAnchorError } = await import("./anchor");

const HASH_A = "a".repeat(64); // test vector
const HASH_B = "b".repeat(64); // test vector
const SIG_OLD = "4".repeat(88); // test vector
const SIG_NEW = "5".repeat(88); // test vector

function setup(opts: {
  head?: { seq: number; hash: string } | null;
  latest?: Record<string, unknown> | null;
  insertError?: boolean;
}) {
  const anchors = (calls: { method: string }[]): Result => {
    if (calls.some((c) => c.method === "insert")) {
      return { data: null, error: opts.insertError ? { code: "23503", message: "fk" } : null };
    }
    return { data: opts.latest ?? null, error: null };
  };
  const db = mockSupabase({
    tables: { audit_events: { data: opts.head ?? null, error: null }, anchors },
  });
  mocks.admin = db.client;
  return db;
}

const latestRow = (seq: number, hash: string) => ({
  head_seq: seq,
  head_hash: hash,
  solana_signature: SIG_OLD,
  cluster: "devnet",
  created_at: "2026-09-26T20:00:00+00:00",
});

function inserts(db: ReturnType<typeof setup>) {
  return (db.queries.anchors ?? []).flatMap((calls) => calls.filter((c) => c.method === "insert"));
}

beforeEach(() => {
  mocks.sendMemo.mockReset();
  mocks.sendMemo.mockResolvedValue(SIG_NEW);
});

describe("getLatestAnchor", () => {
  it("returns the newest signed anchor with an explorer link", async () => {
    setup({ latest: latestRow(10, HASH_A) });
    await expect(getLatestAnchor()).resolves.toEqual({
      headSeq: 10,
      headHash: HASH_A,
      signature: SIG_OLD,
      explorerUrl: `https://explorer.solana.com/tx/${SIG_OLD}?cluster=devnet`,
      cluster: "devnet",
      anchoredAt: "2026-09-26T20:00:00.000Z",
    });
  });

  it("returns null when there are no anchors", async () => {
    setup({ latest: null });
    await expect(getLatestAnchor()).resolves.toBeNull();
  });
});

describe("anchorNow", () => {
  it("throws on an empty log without sending", async () => {
    setup({ head: null });
    await expect(anchorNow()).rejects.toBeInstanceOf(NothingToAnchorError);
    expect(mocks.sendMemo).not.toHaveBeenCalled();
  });

  it("is idempotent on an unchanged head", async () => {
    const db = setup({ head: { seq: 10, hash: HASH_A }, latest: latestRow(10, HASH_A) });
    await expect(anchorNow()).resolves.toEqual({
      signature: SIG_OLD,
      explorerUrl: `https://explorer.solana.com/tx/${SIG_OLD}?cluster=devnet`,
      headSeq: 10,
      headHash: HASH_A,
      reused: true,
    });
    expect(mocks.sendMemo).not.toHaveBeenCalled();
    expect(inserts(db)).toEqual([]);
  });

  it("sends the memo and records the anchor for a new head", async () => {
    const db = setup({ head: { seq: 12, hash: HASH_B }, latest: latestRow(10, HASH_A) });
    await expect(anchorNow()).resolves.toEqual({
      signature: SIG_NEW,
      explorerUrl: `https://explorer.solana.com/tx/${SIG_NEW}?cluster=devnet`,
      headSeq: 12,
      headHash: HASH_B,
      reused: false,
    });
    expect(mocks.sendMemo).toHaveBeenCalledWith(`pledgecheck:v1:12:${HASH_B}`);
    expect(inserts(db).map((c) => c.args[0])).toEqual([
      { head_seq: 12, head_hash: HASH_B, solana_signature: SIG_NEW, cluster: "devnet" },
    ]);
  });

  it("re-anchors when the seq matches but the stored head hash changed", async () => {
    setup({ head: { seq: 10, hash: HASH_B }, latest: latestRow(10, HASH_A) });
    expect((await anchorNow()).reused).toBe(false);
    expect(mocks.sendMemo).toHaveBeenCalledOnce();
  });

  it("surfaces the signature when the transaction confirmed but the insert failed", async () => {
    setup({ head: { seq: 12, hash: HASH_B }, latest: null, insertError: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await anchorNow().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnchorRecordError);
    expect(err).toMatchObject({ signature: SIG_NEW, headSeq: 12, headHash: HASH_B });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ANCHOR NOT RECORDED"), expect.objectContaining({ signature: SIG_NEW }));
    log.mockRestore();
  });

  it("propagates Solana errors without writing a row", async () => {
    const db = setup({ head: { seq: 12, hash: HASH_B }, latest: null });
    mocks.sendMemo.mockRejectedValue(new Error("rpc down"));
    await expect(anchorNow()).rejects.toThrow("rpc down");
    expect(inserts(db)).toEqual([]);
  });
});
