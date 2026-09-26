import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { PATCH } = await import("./route");

const STAFF = "11111111-0000-0000-0000-000000000002";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const PATIENT = "11000000-0000-0000-0000-000000000001";

function setup(opts: { userId?: string | null; clinician?: boolean; patient?: Record<string, unknown> | null; updateError?: boolean } = {}) {
  const userId = opts.userId === undefined ? STAFF : opts.userId;
  mocks.userClient = mockSupabase({
    user: userId ? { id: userId } : null,
    tables: {
      clinicians: { data: opts.clinician === false ? null : { id: userId, practice_id: PRACTICE, role: "staff" }, error: null },
      patients: {
        data: opts.patient === undefined ? { id: PATIENT, practice_id: PRACTICE, home_testing_allowed: false } : opts.patient,
        error: null,
      },
    },
  }).client;
  const admin = mockSupabase({
    tables: { patients: { data: null, error: opts.updateError ? { message: "boom" } : null } },
  });
  mocks.adminClient = admin.client;
  return admin;
}

function patch(body: unknown, id = PATIENT) {
  return PATCH(
    new Request(`http://localhost/api/patients/${id}/home-testing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  mocks.appendAuditEvent.mockReset();
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
});

describe("PATCH /api/patients/:id/home-testing", () => {
  it("400 for a bad body or id", async () => {
    setup();
    expect((await patch({ allowed: "yes" })).status).toBe(400);
    expect((await patch({ allowed: true }, "not-an-id")).status).toBe(400);
  });

  it("401 without a session", async () => {
    setup({ userId: null });
    expect((await patch({ allowed: true })).status).toBe(401);
  });

  it("403 for a user with no clinicians row", async () => {
    setup({ clinician: false });
    expect((await patch({ allowed: true })).status).toBe(403);
  });

  it("404 for a patient hidden by RLS or in another practice", async () => {
    setup({ patient: null });
    expect((await patch({ allowed: true })).status).toBe(404);
    const admin = setup({ patient: { id: PATIENT, practice_id: "20000000-0000-0000-0000-000000000000", home_testing_allowed: false } });
    expect((await patch({ allowed: true })).status).toBe(404);
    expect(admin.client.from).not.toHaveBeenCalled();
  });

  it("updates with the service role, scoped to the practice, and audits { allowed }", async () => {
    const admin = setup();
    const res = await patch({ allowed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ patientId: PATIENT, allowed: true, changed: true });
    const calls = admin.queries.patients[0];
    expect(calls).toContainEqual({ method: "update", args: [{ home_testing_allowed: true }] });
    expect(calls).toContainEqual({ method: "eq", args: ["id", PATIENT] });
    expect(calls).toContainEqual({ method: "eq", args: ["practice_id", PRACTICE] });
    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith({
      actor: `clinician:${STAFF}`,
      action: "patient.home_testing_changed",
      refId: PATIENT,
      payload: { allowed: true },
    });
  });

  it("does nothing (and audits nothing) when the value is unchanged", async () => {
    const admin = setup({ patient: { id: PATIENT, practice_id: PRACTICE, home_testing_allowed: true } });
    expect(await (await patch({ allowed: true })).json()).toEqual({ patientId: PATIENT, allowed: true, changed: false });
    expect(admin.client.from).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("500 update_failed without auditing", async () => {
    setup({ updateError: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await patch({ allowed: true })).status).toBe(500);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("500 audit_failed with changed: true when the audit write fails", async () => {
    setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.appendAuditEvent.mockRejectedValue(new Error("down"));
    const res = await patch({ allowed: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "audit_failed", changed: true, allowed: true });
  });
});
