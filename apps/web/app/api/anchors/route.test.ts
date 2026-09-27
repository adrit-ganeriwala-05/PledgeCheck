import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorRecordError, NothingToAnchorError } from "@/lib/audit/anchor";
import { SolanaConfigError, SolanaFundsError, SolanaRpcError } from "@/lib/audit/solana";
import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  anchorNow: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/audit/anchor", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/audit/anchor")>();
  return { ...real, anchorNow: mocks.anchorNow };
});

const { POST } = await import("./route");

const STAFF = "11111111-0000-0000-0000-000000000002";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const HASH = "a".repeat(64); // test vector
const SIG = "5".repeat(88); // test vector
const EXPLORER = `https://explorer.solana.com/tx/${SIG}?cluster=devnet`;

function signIn(opts: { user?: boolean; clinician?: boolean; role?: "staff" | "prescriber" } = {}) {
  mocks.userClient = mockSupabase({
    user: opts.user === false ? null : { id: STAFF },
    tables: {
      clinicians: {
        data: opts.clinician === false ? null : { id: STAFF, practice_id: PRACTICE, role: opts.role ?? "staff" },
        error: null,
      },
    },
  }).client;
}

beforeEach(() => {
  mocks.anchorNow.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/anchors", () => {
  it("401 without a session, 403 without a clinician row, and never anchors", async () => {
    signIn({ user: false });
    const r1 = await POST();
    expect(r1.status).toBe(401);
    expect(await r1.json()).toEqual({ error: "unauthenticated" });

    signIn({ clinician: false });
    const r2 = await POST();
    expect(r2.status).toBe(403);
    expect(await r2.json()).toEqual({ error: "not_a_clinician" });

    expect(mocks.anchorNow).not.toHaveBeenCalled();
  });

  it.each(["staff", "prescriber"] as const)("200 with the anchor for a %s", async (role) => {
    signIn({ role });
    const body = { signature: SIG, explorerUrl: EXPLORER, headSeq: 12, headHash: HASH, reused: false };
    mocks.anchorNow.mockResolvedValue(body);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
  });

  it("passes reused: true through for an unchanged head", async () => {
    signIn();
    mocks.anchorNow.mockResolvedValue({ signature: SIG, explorerUrl: EXPLORER, headSeq: 12, headHash: HASH, reused: true });
    expect((await (await POST()).json()).reused).toBe(true);
  });

  it.each([
    [new NothingToAnchorError(), 409, { error: "nothing_to_anchor" }],
    [new SolanaConfigError("non_devnet_rpc"), 500, { error: "solana_not_configured" }],
    [new SolanaFundsError(), 502, { error: "wallet_needs_devnet_sol" }],
    [new SolanaRpcError("down"), 502, { error: "solana_unavailable" }],
    [new AnchorRecordError(SIG, 12, HASH), 500, { error: "anchor_not_recorded", signature: SIG, explorerUrl: EXPLORER }],
    [new Error("db down"), 500, { error: "anchor_failed" }],
  ])("maps %s", async (err, status, body) => {
    signIn();
    mocks.anchorNow.mockRejectedValue(err);
    const res = await POST();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});
