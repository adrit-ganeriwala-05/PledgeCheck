import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type QueryCall, type Result } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { POST } = await import("./route");

const USER = "99999999-0000-0000-0000-000000000001";
const PATIENT = "11000000-0000-0000-0000-000000000001";
const REFILL = "cc000001-0000-0000-0000-000000000001";

function setup(opts: {
  user?: string | null;
  patientRow?: Record<string, unknown> | null;
  openRequests?: unknown[];
  openError?: { message: string } | null;
  /** Earlier requests, newest first, as loadFailedTestRun reads them. */
  history?: unknown[];
  insert?: Result;
} = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  const patientRow =
    opts.patientRow === undefined
      ? {
          id: PATIENT,
          practice_id: "10000000-0000-0000-0000-000000000000",
          pseudonym: "Patient A",
          language: "en",
          home_testing_allowed: true,
          phase: "during",
        }
      : opts.patientRow;

  const mock = mockSupabase({
    user: user ? { id: user } : null,
    tables: {
      patients: { data: patientRow, error: null },
      refill_requests: (calls: QueryCall[]) => {
        const isInsert = calls.some((c) => c.method === "insert");
        if (isInsert) {
          return opts.insert ?? { data: { id: REFILL, created_at: "2026-09-27T00:00:00.000Z" }, error: null };
        }
        // Only loadFailedTestRun joins test_requests; the open-request check selects just id.
        if (calls.some((c) => c.method === "select" && String(c.args[0]).includes("test_requests"))) {
          return { data: opts.history ?? [], error: null };
        }
        if (opts.openError) return { data: null, error: opts.openError };
        return { data: opts.openRequests ?? [], error: null };
      },
    },
  });
  mocks.client = mock.client;
  return mock;
}

/** A past request whose test a prescriber rejected: portalStatus reads this as not_verified. */
function failedTest(n: number) {
  return {
    id: `old-${n}`,
    created_at: `2026-0${n}-01T00:00:00.000Z`,
    status: "linked",
    decline_reason: null,
    decided_at: `2026-0${n}-01T01:00:00.000Z`,
    test_request_id: `req-${n}`,
    test_requests: {
      expires_at: `2026-0${n}-02T00:00:00.000Z`,
      submissions: { captured_at: `2026-0${n}-01T02:00:00.000Z`, status: "rejected", reviews: null, windows: null },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "x" });
});

describe("POST /api/portal/refills", () => {
  it("401 without a session", async () => {
    setup({ user: null });
    expect((await POST()).status).toBe(401);
  });

  it("403 for a signed-in user whose account is not linked to a patient", async () => {
    setup({ patientRow: null });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_a_patient" });
  });

  it("creates a request and audits it as the patient", async () => {
    setup();
    const res = await POST();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: REFILL, createdAt: "2026-09-27T00:00:00.000Z" });

    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: `patient:${PATIENT}`, action: "refill.requested", refId: REFILL }),
    );
  });

  it("never lets the caller choose the patient id", async () => {
    const mock = setup();
    await POST();
    const insertCall = mock.queries.refill_requests
      .flat()
      .find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual({ patient_id: PATIENT });
  });

  it("409 when a request is already waiting", async () => {
    setup({ openRequests: [{ id: "existing" }] });
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_pending" });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("one failed test still earns another link", async () => {
    setup({ history: [failedTest(1)] });
    const res = await POST();
    expect(res.status).toBe(201);
    expect(mocks.appendAuditEvent).toHaveBeenCalled();
  });

  it("409 clinic_visit_required after two failed tests in a row, and nothing is created", async () => {
    const mock = setup({ history: [failedTest(2), failedTest(1)] });
    const res = await POST();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "clinic_visit_required" });
    expect(mock.queries.refill_requests.flat().some((c) => c.method === "insert")).toBe(false);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("500 and no audit when the insert fails", async () => {
    setup({ insert: { data: null, error: { message: "denied" } } });
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "request_failed" });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("500 when the open-request check fails, rather than creating a duplicate", async () => {
    setup({ openError: { message: "db down" } });
    expect((await POST()).status).toBe(500);
  });

  it("keeps the request when the audit write fails", async () => {
    setup();
    mocks.appendAuditEvent.mockRejectedValue(new Error("audit down"));
    const res = await POST();
    expect(res.status).toBe(201);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AUDIT EVENT NOT WRITTEN"),
      expect.anything(),
    );
  });
});
