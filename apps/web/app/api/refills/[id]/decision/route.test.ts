import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type Result } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
  issueTestLink: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/lib/clinic/issue-link", () => ({ issueTestLink: mocks.issueTestLink }));
vi.mock("@/lib/integrations/email", () => ({ send: mocks.send, isConfigured: () => false }));

const { POST } = await import("./route");

const CLINICIAN = "11111111-0000-0000-0000-000000000001";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const OTHER_PRACTICE = "20000000-0000-0000-0000-000000000000";
const PATIENT = "11000000-0000-0000-0000-000000000001";
const REFILL = "cc000001-0000-0000-0000-000000000001";
const REQUEST_ID = "dd000001-0000-0000-0000-000000000001";

function ctx(id = REFILL) {
  return { params: Promise.resolve({ id }) } as never;
}

function body(payload: unknown) {
  return new Request("http://localhost/api/refills/x/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function setup(opts: {
  role?: "prescriber" | "staff" | null;
  refill?: Record<string, unknown> | null;
  patientPractice?: string;
  contactEmail?: string | null;
  homeAllowed?: boolean;
  updateError?: { message: string } | null;
} = {}) {
  const role = opts.role === undefined ? "prescriber" : opts.role;
  const refill =
    opts.refill === undefined
      ? {
          id: REFILL,
          status: "requested",
          patient_id: PATIENT,
          patients: {
            id: PATIENT,
            practice_id: opts.patientPractice ?? PRACTICE,
            contact_email: opts.contactEmail === undefined ? "p@example.test" : opts.contactEmail,
            can_get_pregnant: true,
            home_testing_allowed: opts.homeAllowed ?? true,
            phase: "during",
          },
        }
      : opts.refill;

  mocks.userClient = mockSupabase({
    user: { id: CLINICIAN },
    tables: {
      clinicians: { data: role ? { id: CLINICIAN, practice_id: PRACTICE, role } : null, error: null },
      refill_requests: { data: refill, error: null } as Result,
    },
  }).client;

  const admin = mockSupabase({
    tables: { refill_requests: { data: null, error: opts.updateError ?? null } },
  });
  mocks.adminClient = admin.client;
  return admin;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "x" });
  mocks.issueTestLink.mockResolvedValue({
    ok: true,
    requestId: REQUEST_ID,
    token: "TOKEN123",
    expiresAt: "2026-09-28T00:00:00.000Z",
  });
  mocks.send.mockResolvedValue({ ok: true, id: "email_1" });
});

describe("POST /api/refills/[id]/decision", () => {
  it("400 on an unknown decision", async () => {
    setup();
    expect((await POST(body({ decision: "maybe" }), ctx())).status).toBe(400);
  });

  it("400 when declining without a reason", async () => {
    setup();
    expect((await POST(body({ decision: "decline", reason: "  " }), ctx())).status).toBe(400);
  });

  it("403 for a user who is not a clinician", async () => {
    setup({ role: null });
    expect((await POST(body({ decision: "approve" }), ctx())).status).toBe(403);
  });

  it("404 for a request belonging to another practice", async () => {
    setup({ patientPractice: OTHER_PRACTICE });
    expect((await POST(body({ decision: "approve" }), ctx())).status).toBe(404);
    expect(mocks.issueTestLink).not.toHaveBeenCalled();
  });

  it("409 when the request was already decided", async () => {
    setup({ refill: { id: REFILL, status: "declined", patient_id: PATIENT, patients: { id: PATIENT, practice_id: PRACTICE, contact_email: null, can_get_pregnant: true, home_testing_allowed: true, phase: "during" } } });
    expect((await POST(body({ decision: "approve" }), ctx())).status).toBe(409);
    expect(mocks.issueTestLink).not.toHaveBeenCalled();
  });

  it("declines with a reason and audits it", async () => {
    setup();
    const res = await POST(body({ decision: "decline", reason: "Seen in clinic last week" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decision: "declined" });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "refill.declined", actor: `clinician:${CLINICIAN}` }),
    );
    expect(mocks.issueTestLink).not.toHaveBeenCalled();
  });

  it("approving issues a link, attaches it and emails the patient", async () => {
    setup();
    const res = await POST(body({ decision: "approve" }), ctx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, decision: "linked", emailed: true });
    expect(String(json.link)).toContain("/t/TOKEN123");

    expect(mocks.issueTestLink).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PATIENT, clinicianId: CLINICIAN, setting: "home" }),
    );
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "p@example.test" }));
  });

  it("does not put the challenge code in the email", async () => {
    setup();
    await POST(body({ decision: "approve" }), ctx());
    const sent = mocks.send.mock.calls[0][0] as { text: string; subject: string };
    // The code is shown on screen after Start; an emailed code would defeat the check.
    expect(sent.text).not.toMatch(/\b[A-Z0-9]{4}\b(?!.*character)/);
    expect(sent.text).toContain("/t/TOKEN123");
  });

  it("still returns the link when the email fails", async () => {
    setup();
    mocks.send.mockResolvedValue({ ok: false, reason: "email_not_configured" });
    const res = await POST(body({ decision: "approve" }), ctx());
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.emailed).toBe(false);
    expect(String(json.link)).toContain("/t/TOKEN123");
  });

  it("skips email when the patient has no address, and still succeeds", async () => {
    setup({ contactEmail: null });
    const res = await POST(body({ decision: "approve" }), ctx());
    expect((await res.json() as Record<string, unknown>).emailed).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses a home link for a patient not cleared for home testing", async () => {
    setup({ homeAllowed: false });
    const res = await POST(body({ decision: "approve", setting: "home" }), ctx());
    expect(res.status).toBe(409);
    expect(mocks.issueTestLink).not.toHaveBeenCalled();
  });

  it("500 and no email when the link could not be issued", async () => {
    setup();
    mocks.issueTestLink.mockResolvedValue({ ok: false, error: "issue_failed" });
    expect((await POST(body({ decision: "approve" }), ctx())).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
