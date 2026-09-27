import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.sendEmail }));

const { issueAndEmailTestLink } = await import("./email-link");

const STAFF = "11111111-0000-0000-0000-000000000002";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const PATIENT = "11000000-0000-0000-0000-000000000001";
const REQUEST_ID = "12000000-0000-0000-0000-000000000001";
const EMAIL = "patient@example.com";

function setup(patient: Record<string, unknown> = {}) {
  const user = mockSupabase({
    tables: {
      patients: {
        data: {
          id: PATIENT,
          practice_id: PRACTICE,
          can_get_pregnant: true,
          home_testing_allowed: true,
          phase: "during",
          language: "en",
          ...patient,
        },
        error: null,
      },
    },
  });
  const admin = mockSupabase({ tables: { test_requests: { data: { id: REQUEST_ID }, error: null } } });
  mocks.adminClient = admin.client;
  return { user, admin };
}

function approve(user: ReturnType<typeof setup>["user"]) {
  return issueAndEmailTestLink({
    supabase: user.client as never,
    clinician: { id: STAFF, practiceId: PRACTICE, role: "staff" },
    patientId: PATIENT,
    setting: "home",
    origin: "https://pledgecheck.tech",
    email: EMAIL,
  });
}

beforeEach(() => {
  mocks.appendAuditEvent.mockReset();
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue({ id: "msg_123" });
});

describe("issueAndEmailTestLink", () => {
  it("issues the link, emails it to the patient and logs both events without the address", async () => {
    const { user, admin } = setup();
    const result = await approve(user);

    expect(result).toMatchObject({ ok: true, requestId: REQUEST_ID, emailed: true });
    if (!result.ok) throw new Error("expected ok");
    expect(result.link).toMatch(/^https:\/\/pledgecheck\.tech\/t\/[A-Za-z0-9_-]{43}$/);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const message = mocks.sendEmail.mock.calls[0][0];
    expect(message.to).toBe(EMAIL);
    expect(message.text).toContain(result.link);
    expect(message.html).toContain(result.link);

    const insert = admin.queries.test_requests[0].find((c) => c.method === "insert")!.args[0] as {
      challenge_code: string;
    };
    expect(message.text).not.toContain(insert.challenge_code);

    expect(mocks.appendAuditEvent.mock.calls.map((c) => c[0].action)).toEqual([
      "request.issued",
      "request.emailed",
    ]);
    expect(mocks.appendAuditEvent.mock.calls[1][0]).toEqual({
      actor: `clinician:${STAFF}`,
      action: "request.emailed",
      refId: REQUEST_ID,
      payload: { provider: "resend", messageId: "msg_123" },
    });
    expect(JSON.stringify(mocks.appendAuditEvent.mock.calls)).not.toContain(EMAIL);
  });

  it("sends the Spanish email to a Spanish-speaking patient", async () => {
    const { user } = setup({ language: "es" });
    await approve(user);
    expect(mocks.sendEmail.mock.calls[0][0].subject).toBe("Su enlace de PledgeCheck");
  });

  it("still returns the link, with emailed: false, when the email fails", async () => {
    const { user } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockRejectedValue(new Error("resend down"));

    const result = await approve(user);
    expect(result).toMatchObject({ ok: true, requestId: REQUEST_ID, emailed: false });
    expect(mocks.appendAuditEvent.mock.calls.map((c) => c[0].action)).toEqual(["request.issued"]);
  });

  it("sends nothing when the link cannot be issued", async () => {
    const { user } = setup({ home_testing_allowed: false });
    const result = await approve(user);
    expect(result).toMatchObject({ ok: false, status: 409, error: "home_testing_not_allowed" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when the request.issued event cannot be written", async () => {
    const { user } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.appendAuditEvent.mockRejectedValue(new Error("down"));
    const result = await approve(user);
    expect(result).toMatchObject({ ok: false, error: "audit_failed" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
