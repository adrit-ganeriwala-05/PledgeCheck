import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type QueryCall } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
  recordAccessEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/chain", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/lib/analytics/tiger", () => ({ recordAccessEvent: mocks.recordAccessEvent }));

const { POST } = await import("./route");

const CLINICIAN = "11111111-0000-0000-0000-000000000001";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const W1 = "aa000001-0000-0000-0000-000000000001";
const W2 = "aa000002-0000-0000-0000-000000000002";
const PAST = "2026-09-01T00:00:00.000Z";

/** `overdue` is the read; `claimed` decides, per update call, whether the row was won. */
function setup(opts: {
  role?: "prescriber" | "staff" | null;
  overdue?: { id: string; closes_at: string }[];
  readError?: { message: string } | null;
  claimed?: boolean[];
} = {}) {
  const role = opts.role === undefined ? "prescriber" : opts.role;
  const overdue = opts.overdue ?? [];
  const claimed = opts.claimed ?? overdue.map(() => true);

  mocks.userClient = mockSupabase({
    user: { id: CLINICIAN },
    tables: { clinicians: { data: role ? { id: CLINICIAN, practice_id: PRACTICE, role } : null, error: null } },
  }).client;

  let updateIndex = 0;
  const admin = mockSupabase({
    tables: {
      windows: (calls: QueryCall[]) => {
        const isUpdate = calls.some((c) => c.method === "update");
        if (!isUpdate) {
          return opts.readError ? { data: null, error: opts.readError } : { data: overdue, error: null };
        }
        const won = claimed[updateIndex++] ?? false;
        return { data: won ? [{ id: "x" }] : [], error: null };
      },
    },
  });
  mocks.adminClient = admin.client;
  return { admin };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "x" });
  mocks.recordAccessEvent.mockResolvedValue(true);
});

describe("POST /api/windows/sweep", () => {
  it("401 without a session", async () => {
    mocks.userClient = mockSupabase({ user: null }).client;
    mocks.adminClient = mockSupabase({}).client;
    expect((await POST()).status).toBe(401);
  });

  it("403 for a signed-in user with no clinicians row", async () => {
    setup({ role: null });
    expect((await POST()).status).toBe(403);
  });

  it("sweeps nothing when no window is overdue", async () => {
    setup({ overdue: [] });
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, swept: 0, windowIds: [] });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
    expect(mocks.recordAccessEvent).not.toHaveBeenCalled();
  });

  it("marks an overdue window missed, audits it and records the analytics event", async () => {
    setup({ overdue: [{ id: W1, closes_at: PAST }] });
    const res = await POST();

    expect(await res.json()).toEqual({ ok: true, swept: 1, windowIds: [W1] });

    const [, event] = mocks.appendAuditEvent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(event).toMatchObject({ actor: "system", action: "window.missed", refId: W1 });

    expect(mocks.recordAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ practiceId: PRACTICE, event: "missed" }),
    );
    // A missed window was never filled, so there is nothing to time.
    const call = mocks.recordAccessEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.daysToFill).toBeUndefined();
  });

  it("only updates rows still open, so the sweep is race-safe", async () => {
    const { admin } = setup({ overdue: [{ id: W1, closes_at: PAST }] });
    await POST();
    const updateCalls = admin.queries.windows.find((q) => q.some((c) => c.method === "update"));
    const eqArgs = (updateCalls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["status", "open"]);
    expect(eqArgs).toContainEqual(["id", W1]);
  });

  it("skips a window another caller already claimed", async () => {
    setup({ overdue: [{ id: W1, closes_at: PAST }, { id: W2, closes_at: PAST }], claimed: [false, true] });
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, swept: 1, windowIds: [W2] });
    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("does not record analytics for a window it did not claim", async () => {
    setup({ overdue: [{ id: W1, closes_at: PAST }], claimed: [false] });
    await POST();
    expect(mocks.recordAccessEvent).not.toHaveBeenCalled();
  });

  it("a warehouse failure does not undo the sweep", async () => {
    setup({ overdue: [{ id: W1, closes_at: PAST }] });
    mocks.recordAccessEvent.mockRejectedValue(new Error("tiger down"));
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, swept: 1, windowIds: [W1] });
  });

  it("500 when the overdue read fails, and writes nothing", async () => {
    setup({ readError: { message: "db down" } });
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, reason: "sweep_failed" });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("scopes the read to the caller's practice and to open, past-deadline rows", async () => {
    const { admin } = setup({ overdue: [] });
    await POST();
    const read = admin.queries.windows[0];
    expect(read.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "patients.practice_id",
      PRACTICE,
    ]);
    expect(read.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual(["status", "open"]);
    expect(read.some((c) => c.method === "lt" && c.args[0] === "closes_at")).toBe(true);
  });
});
