import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationUnavailableError } from "@/lib/integrations/errors";
import { mockSupabase, type MockConfig, type Result } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  openApprovalWindow: vi.fn(),
  append: vi.fn(),
  recordAccessEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/integrations/window", () => ({ openApprovalWindow: mocks.openApprovalWindow }));
vi.mock("@/lib/integrations/audit", () => ({ append: mocks.append }));
vi.mock("@/lib/analytics/tiger", () => ({ recordAccessEvent: mocks.recordAccessEvent }));

const { POST } = await import("./route");

const RX = "11111111-0000-0000-0000-000000000001";
const STAFF = "11111111-0000-0000-0000-000000000002";
const SUB = "13000000-0000-0000-0000-000000000001";
const PATIENT = "11000000-0000-0000-0000-000000000001";
const PHOTO = `10000000-0000-0000-0000-000000000000/${SUB}.jpg`;
const WINDOW = { opensAt: "2026-09-26T15:00:00Z", closesAt: "2026-10-03T15:00:00Z", isFirstRx: false };

type Setup = {
  userId?: string | null;
  role?: "prescriber" | "staff" | null;
  submission?: Record<string, unknown> | null;
  rpc?: MockConfig["rpc"];
  remove?: Result;
  adminUpdateError?: { message: string } | null;
};

function setup(opts: Setup = {}) {
  const userId = opts.userId === undefined ? RX : opts.userId;
  const role = opts.role === undefined ? "prescriber" : opts.role;
  const rpc = opts.rpc ?? { data: { status: "approved", window: { opens_at: WINDOW.opensAt, closes_at: WINDOW.closesAt, is_first_rx: false } }, error: null };
  const user = mockSupabase({
    user: userId ? { id: userId } : null,
    tables: {
      clinicians: { data: role ? { id: userId, practice_id: "10000000-0000-0000-0000-000000000000", role } : null, error: null },
      submissions: {
        data:
          opts.submission === undefined
            ? { id: SUB, status: "ready_for_review", photo_path: PHOTO, test_requests: { patient_id: PATIENT } }
            : opts.submission,
        error: null,
      },
    },
  });
  const admin = mockSupabase({
    rpc,
    tables: { submissions: { data: null, error: opts.adminUpdateError ?? null } },
    storage: { remove: opts.remove ?? { data: [], error: null } },
  });
  mocks.userClient = user.client;
  mocks.adminClient = admin.client;
  return { user, admin };
}

function request(body: unknown) {
  return new Request("http://localhost/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.openApprovalWindow.mockResolvedValue(WINDOW);
  mocks.append.mockResolvedValue(undefined);
  mocks.recordAccessEvent.mockResolvedValue(true);
});

describe("POST /api/reviews — auth", () => {
  it("401 without a session", async () => {
    setup({ userId: null });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(401);
  });

  it("403 for a signed-in user with no clinicians row", async () => {
    setup({ role: null });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(403);
  });

  it("403 for staff", async () => {
    const { admin } = setup({ userId: STAFF, role: "staff" });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "prescriber_only" });
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/reviews — validation", () => {
  it("400 on invalid JSON", async () => {
    setup();
    expect((await POST(request("{not json"))).status).toBe(400);
  });

  it.each([
    [{ decision: "approved" }],
    [{ submissionId: "not-a-uuid", decision: "approved" }],
    [{ submissionId: SUB, decision: "maybe" }],
    [{ submissionId: SUB, decision: "rejected", reason: "x".repeat(501) }],
  ])("400 on bad body %j", async (body) => {
    setup();
    expect((await POST(request(body))).status).toBe(400);
  });

  it("400 when rejecting without a reason (blank counts as missing)", async () => {
    const { admin } = setup();
    for (const body of [{ submissionId: SUB, decision: "rejected" }, { submissionId: SUB, decision: "rejected", reason: "   " }]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/reviews — approve", () => {
  it("200 approved; window comes from the adapter with approvedAt and is passed to the RPC", async () => {
    const { admin } = setup();
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "approved", window: { opensAt: WINDOW.opensAt, closesAt: WINDOW.closesAt } });

    expect(mocks.openApprovalWindow).toHaveBeenCalledOnce();
    const input = mocks.openApprovalWindow.mock.calls[0][0];
    expect(input).toMatchObject({ patientId: PATIENT, submissionId: SUB });
    expect(new Date(input.approvedAt).toISOString()).toBe(input.approvedAt);

    expect(admin.client.rpc).toHaveBeenCalledWith("submit_review", {
      p_clinician_id: RX,
      p_submission_id: SUB,
      p_decision: "approved",
      p_reason: null,
      p_window: { opens_at: WINDOW.opensAt, closes_at: WINDOW.closesAt, is_first_rx: false },
    });
    expect(mocks.append).toHaveBeenCalledWith({
      actor: `clinician:${RX}`,
      action: "review.approved",
      refId: SUB,
      payload: { decision: "approved", reason: null },
    });
  });

  it("records the decision only through the server-side RPC, never the user's client", async () => {
    const { user, admin } = setup();
    await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(user.client.rpc).not.toHaveBeenCalled();
    expect(admin.client.rpc).toHaveBeenCalledOnce();
  });

  it("503 and nothing written when the window logic is unavailable", async () => {
    const { admin } = setup();
    mocks.openApprovalWindow.mockRejectedValue(new IntegrationUnavailableError("window"));
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "window_logic_unavailable" });
    expect(admin.client.rpc).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("500 and nothing written when the window logic throws", async () => {
    const { admin } = setup();
    mocks.openApprovalWindow.mockRejectedValue(new Error("boom"));
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(500);
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });

  it("route source contains no date math", () => {
    const source = readFileSync(path.join(import.meta.dirname, "route.ts"), "utf8");
    expect(source).not.toMatch(/setDate|setHours|setTime|addDays|getTime\(\)\s*[+-]|Date\.now\(\)\s*[+-]|86_?400|7\s*\*\s*24|\+\s*7\b/);
  });
});

describe("POST /api/reviews — reject", () => {
  it("200 rejected with a reason; window adapter not called", async () => {
    const { admin } = setup({ rpc: { data: { status: "rejected", window: null }, error: null } });
    const res = await POST(request({ submissionId: SUB, decision: "rejected", reason: "  Test line unclear  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "rejected", window: null });
    expect(mocks.openApprovalWindow).not.toHaveBeenCalled();
    expect(admin.client.rpc).toHaveBeenCalledWith("submit_review", expect.objectContaining({
      p_decision: "rejected", p_reason: "Test line unclear", p_window: null,
    }));
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ action: "review.rejected" }));
  });
});

describe("POST /api/reviews — conflicts and lookups", () => {
  it("404 for an unknown or other-practice submission (RLS hides it)", async () => {
    const { admin } = setup({ submission: null });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(404);
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });

  it("409 when the submission is not reviewable", async () => {
    const { admin } = setup({ submission: { id: SUB, status: "approved", photo_path: null, test_requests: { patient_id: PATIENT } } });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_reviewable" });
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", 409, "already_reviewed"],
    ["PC409", 409, "not_reviewable"],
    ["42501", 403, "forbidden"],
    ["P0002", 404, "not_found"],
    ["22023", 400, "invalid_request"],
    ["XX000", 500, "review_failed"],
  ])("maps RPC error %s to %i", async (code, status, error) => {
    setup({ rpc: { data: null, error: { code, message: "x" } } });
    const res = await POST(request({ submissionId: SUB, decision: "rejected", reason: "r" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(mocks.append).not.toHaveBeenCalled();
  });
});

describe("POST /api/reviews — after the decision is saved", () => {
  it("deletes the photo and clears photo_path", async () => {
    const { admin } = setup();
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(200);
    expect(admin.remove).toHaveBeenCalledWith([PHOTO]);
    const updates = admin.queries.submissions[0];
    expect(updates).toContainEqual({ method: "update", args: [{ photo_path: null }] });
    expect(updates).toContainEqual({ method: "eq", args: ["id", SUB] });
  });

  it("skips storage when there is no photo_path", async () => {
    const { admin } = setup({ submission: { id: SUB, status: "needs_review", photo_path: null, test_requests: { patient_id: PATIENT } } });
    expect((await POST(request({ submissionId: SUB, decision: "approved" }))).status).toBe(200);
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it("an already-missing object counts as deleted", async () => {
    setup({ remove: { data: [], error: null } });
    expect((await POST(request({ submissionId: SUB, decision: "approved" }))).status).toBe(200);
  });

  it("500 photo_delete_failed with reviewRecorded when storage delete fails", async () => {
    setup({ remove: { data: null, error: { message: "storage down" } } });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "photo_delete_failed", reviewRecorded: true });
  });

  it("500 photo_delete_failed when clearing photo_path fails", async () => {
    setup({ adminUpdateError: { message: "db down" } });
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(await res.json()).toEqual({ error: "photo_delete_failed", reviewRecorded: true });
  });

  it("500 audit_failed with reviewRecorded, logged loudly; photo still deleted", async () => {
    const { admin } = setup();
    mocks.append.mockRejectedValue(new IntegrationUnavailableError("audit"));
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "audit_failed", reviewRecorded: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("AUDIT EVENT NOT WRITTEN"), expect.anything());
    expect(admin.remove).toHaveBeenCalledWith([PHOTO]);
  });
});

describe("POST /api/reviews — access analytics", () => {
  const PRACTICE = "10000000-0000-0000-0000-000000000000";

  it("records a verified event on approval, with no patient in it", async () => {
    setup();
    await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(mocks.recordAccessEvent).toHaveBeenCalledTimes(1);
    const [event] = mocks.recordAccessEvent.mock.calls[0] as [Record<string, unknown>];
    expect(event).toEqual({ practiceId: PRACTICE, event: "verified" });
    expect(JSON.stringify(event)).not.toContain(PATIENT);
    expect(JSON.stringify(event)).not.toContain(SUB);
  });

  it("records a rejected event on rejection", async () => {
    setup({ rpc: { data: { status: "rejected", window: null }, error: null } });
    await POST(request({ submissionId: SUB, decision: "rejected", reason: "blurry" }));
    expect(mocks.recordAccessEvent).toHaveBeenCalledWith({ practiceId: PRACTICE, event: "rejected" });
  });

  it("does not record anything when the review never happened", async () => {
    setup({ role: "staff", userId: STAFF });
    await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(mocks.recordAccessEvent).not.toHaveBeenCalled();
  });

  it("a warehouse failure does not fail the review", async () => {
    setup();
    mocks.recordAccessEvent.mockRejectedValue(new Error("tiger down"));
    const res = await POST(request({ submissionId: SUB, decision: "approved" }));
    expect(res.status).toBe(200);
  });
});
