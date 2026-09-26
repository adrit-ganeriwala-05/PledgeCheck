import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeHash, GENESIS_PREV_HASH } from "./hash";

type Head = { seq: number; hash: string } | null;

const state: {
  heads: Head[];
  rpcResults: Array<{ data: unknown; error: { code?: string; message?: string } | null }>;
} = { heads: [], rpcResults: [] };

const rpc = vi.fn(async () => state.rpcResults.shift() ?? { data: 1, error: null });
const maybeSingle = vi.fn(async () => ({ data: state.heads.length > 1 ? state.heads.shift() : state.heads[0] ?? null, error: null }));
const query = { select: () => query, order: () => query, limit: () => query, maybeSingle };
const from = vi.fn(() => query);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));

const scheduleAutoAnchor = vi.fn(async () => {});
vi.mock("./auto-anchor", () => ({ scheduleAutoAnchor }));

const { appendAuditEvent, append, AuditAppendError, AuditValidationError } = await import("./append");

const CLINICIAN = "clinician:a0000000-0000-0000-0000-000000000001";
const REF = "a3000001-0000-0000-0000-000000000000";
const HEAD_HASH = "1".repeat(64); // test vector
const CONFLICT = { data: null, error: { code: "40001", message: "audit_chain_conflict" } };

type RpcArgs = {
  p_seq: number;
  p_prev_hash: string;
  p_hash: string;
  p_actor: string;
  p_action: string;
  p_ref_id: string | null;
  p_payload: Record<string, unknown>;
  p_created_at: string;
};
function rpcArgs(call = 0): RpcArgs {
  return (rpc.mock.calls[call] as unknown as [string, RpcArgs])[1];
}

beforeEach(() => {
  state.heads = [];
  state.rpcResults = [];
  rpc.mockClear();
  maybeSingle.mockClear();
  scheduleAutoAnchor.mockClear();
});

describe("appendAuditEvent", () => {
  it("appends at head + 1 with the recomputed hash", async () => {
    state.heads = [{ seq: 4, hash: HEAD_HASH }];
    const payload = { decision: "approved", submission_id: REF };
    const result = await appendAuditEvent({ actor: CLINICIAN, action: "review.approved", refId: REF, payload });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect((rpc.mock.calls[0] as unknown[])[0]).toBe("audit_append");
    const args = rpcArgs();
    expect(args.p_seq).toBe(5);
    expect(args.p_prev_hash).toBe(HEAD_HASH);
    expect(args.p_created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const expected = computeHash(HEAD_HASH, {
      seq: 5,
      actor: CLINICIAN,
      action: "review.approved",
      ref_id: REF,
      payload,
      created_at: args.p_created_at,
    });
    expect(args.p_hash).toBe(expected);
    expect(result).toEqual({ seq: 5, hash: expected });
  });

  it("starts at seq 1 with the genesis prev_hash on an empty table", async () => {
    state.heads = [null];
    const result = await appendAuditEvent({ actor: "system", action: "window.missed" });
    const args = rpcArgs();
    expect(args.p_seq).toBe(1);
    expect(args.p_prev_hash).toBe(GENESIS_PREV_HASH);
    expect(args.p_ref_id).toBeNull();
    expect(args.p_payload).toEqual({});
    expect(result.seq).toBe(1);
  });

  it("retries on a chain conflict, re-reading the head", async () => {
    const newer = "2".repeat(64); // test vector
    state.heads = [{ seq: 4, hash: HEAD_HASH }, { seq: 5, hash: newer }];
    state.rpcResults = [CONFLICT];
    const result = await appendAuditEvent({ actor: "system", action: "window.filled" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpcArgs(1).p_seq).toBe(6);
    expect(rpcArgs(1).p_prev_hash).toBe(newer);
    expect(result.seq).toBe(6);
  });

  it("gives up after five conflicts", async () => {
    state.heads = [{ seq: 4, hash: HEAD_HASH }];
    state.rpcResults = Array(5).fill(CONFLICT);
    await expect(appendAuditEvent({ actor: "system", action: "window.filled" })).rejects.toBeInstanceOf(
      AuditAppendError,
    );
    expect(rpc).toHaveBeenCalledTimes(5);
  });

  it("does not retry other RPC errors", async () => {
    state.heads = [null];
    state.rpcResults = [{ data: null, error: { code: "42501", message: "permission denied" } }];
    await expect(appendAuditEvent({ actor: "system", action: "window.filled" })).rejects.toBeInstanceOf(
      AuditAppendError,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid actor", { actor: "admin", action: "review.approved" }],
    ["clinician without uuid", { actor: "clinician:bob", action: "review.approved" }],
    ["invalid action", { actor: "system", action: "anchor.created" }],
    ["non-uuid refId", { actor: "system", action: "window.filled", refId: "42" }],
    ["float in payload", { actor: "system", action: "window.filled", payload: { confidence: 0.93 } }],
    ["denylisted photo key", { actor: "system", action: "submission.received", payload: { photo_path: "x" } }],
    ["denylisted nested token", { actor: "system", action: "request.issued", payload: { req: { token: "x" } } }],
    ["denylisted challenge_code", { actor: "system", action: "request.issued", payload: { challenge_code: "K7Q2" } }],
    ["denylisted phash", { actor: "system", action: "submission.received", payload: { phash: "abc" } }],
    ["denylisted image", { actor: "system", action: "submission.received", payload: { items: [{ imageData: "x" }] } }],
  ])("rejects %s before any RPC", async (_label, input) => {
    state.heads = [null];
    await expect(appendAuditEvent(input as never)).rejects.toBeInstanceOf(AuditValidationError);
    expect(rpc).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("schedules an auto-anchor only when seq is a multiple of 10", async () => {
    for (const headSeq of [8, 9, 10, 18, 19]) {
      state.heads = [{ seq: headSeq, hash: HEAD_HASH }];
      await appendAuditEvent({ actor: "system", action: "window.filled" });
    }
    // New seqs were 9, 10, 11, 19, 20.
    expect(scheduleAutoAnchor).toHaveBeenCalledTimes(2);
  });

  it("still succeeds when auto-anchor throws", async () => {
    state.heads = [{ seq: 9, hash: HEAD_HASH }];
    scheduleAutoAnchor.mockRejectedValueOnce(new Error("boom"));
    await expect(appendAuditEvent({ actor: "system", action: "window.filled" })).resolves.toMatchObject({
      seq: 10,
    });
  });

  it("exports append as an alias", () => {
    expect(append).toBe(appendAuditEvent);
  });
});
