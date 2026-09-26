import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "@/lib/fraud/token";
import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { POST } = await import("./route");

const STAFF = "11111111-0000-0000-0000-000000000002";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const OTHER_PRACTICE = "20000000-0000-0000-0000-000000000000";
const PATIENT = "11000000-0000-0000-0000-000000000001";
const REQUEST_ID = "12000000-0000-0000-0000-000000000001";

type Setup = {
  userId?: string | null;
  clinician?: boolean;
  patient?: Record<string, unknown> | null;
  insertError?: { message: string } | null;
};

function setup(opts: Setup = {}) {
  const userId = opts.userId === undefined ? STAFF : opts.userId;
  const user = mockSupabase({
    user: userId ? { id: userId } : null,
    tables: {
      clinicians: {
        data: opts.clinician === false ? null : { id: userId, practice_id: PRACTICE, role: "staff" },
        error: null,
      },
      patients: {
        data:
          opts.patient === undefined
            ? { id: PATIENT, practice_id: PRACTICE, can_get_pregnant: true, home_testing_allowed: true, phase: "during" }
            : opts.patient,
        error: null,
      },
    },
  });
  const admin = mockSupabase({
    tables: {
      test_requests: opts.insertError
        ? { data: null, error: opts.insertError }
        : { data: { id: REQUEST_ID }, error: null },
    },
  });
  mocks.userClient = user.client;
  mocks.adminClient = admin.client;
  return { user, admin };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const home = { patientId: PATIENT, setting: "home" };

beforeEach(() => {
  mocks.appendAuditEvent.mockReset();
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
});

describe("POST /api/requests", () => {
  it("400 for an invalid body", async () => {
    setup();
    expect((await post({ patientId: "nope", setting: "home" })).status).toBe(400);
    expect((await post({ patientId: PATIENT, setting: "car" })).status).toBe(400);
  });

  it("401 without a session", async () => {
    setup({ userId: null });
    const res = await post(home);
    expect(res.status).toBe(401);
  });

  it("403 for a user with no clinicians row", async () => {
    setup({ clinician: false });
    expect((await post(home)).status).toBe(403);
  });

  it("404 for a patient hidden by RLS or in another practice", async () => {
    setup({ patient: null });
    expect((await post(home)).status).toBe(404);
    setup({
      patient: { id: PATIENT, practice_id: OTHER_PRACTICE, can_get_pregnant: true, home_testing_allowed: true, phase: "during" },
    });
    expect((await post(home)).status).toBe(404);
  });

  it.each([
    ["home testing not allowed", { home_testing_allowed: false }, "not_permitted"],
    ["pre-treatment phase", { phase: "pre" }, "pre_treatment"],
    ["cannot get pregnant", { can_get_pregnant: false }, "cannot_get_pregnant"],
  ])("409 home link refused: %s", async (_label, override, reason) => {
    const { admin } = setup({
      patient: {
        id: PATIENT,
        practice_id: PRACTICE,
        can_get_pregnant: true,
        home_testing_allowed: true,
        phase: "during",
        ...override,
      },
    });
    const res = await post(home);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "home_testing_not_allowed", reason });
    expect(admin.client.from).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("allows a clinic link for a pre-treatment patient", async () => {
    setup({
      patient: { id: PATIENT, practice_id: PRACTICE, can_get_pregnant: true, home_testing_allowed: false, phase: "pre" },
    });
    expect((await post({ patientId: PATIENT, setting: "clinic" })).status).toBe(200);
  });

  it("issues a link: stores only the hash, returns no code, writes one clean audit event", async () => {
    const { admin } = setup();
    const res = await post(home);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["expiresAt", "link", "requestId"]);
    expect(body.requestId).toBe(REQUEST_ID);
    const match = /^http:\/\/localhost:3000\/t\/([A-Za-z0-9_-]{43})$/.exec(body.link);
    expect(match).not.toBeNull();
    const token = match![1];

    const expiresIn = Date.parse(body.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(23.9 * 3600_000);
    expect(expiresIn).toBeLessThanOrEqual(24 * 3600_000);

    const insert = admin.queries.test_requests[0].find((c) => c.method === "insert")!.args[0] as Record<
      string,
      string
    >;
    expect(insert.token_hash).toBe(hashToken(token));
    expect(insert.token_hash).not.toBe(token);
    expect(insert.challenge_code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
    expect(insert).toMatchObject({ patient_id: PATIENT, setting: "home", created_by: STAFF });
    expect(JSON.stringify(body)).not.toContain(insert.challenge_code);

    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
    const event = mocks.appendAuditEvent.mock.calls[0][0];
    expect(event).toEqual({
      actor: `clinician:${STAFF}`,
      action: "request.issued",
      refId: REQUEST_ID,
      payload: { setting: "home" },
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(insert.challenge_code);
    expect(serialized).not.toContain(insert.token_hash);
  });

  it("500 issue_failed when the insert fails", async () => {
    setup({ insertError: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(home);
    expect(res.status).toBe(500);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("withholds the link when the audit event cannot be written", async () => {
    setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.appendAuditEvent.mockRejectedValue(new Error("down"));
    const res = await post(home);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "audit_failed" });
  });
});
