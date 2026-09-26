import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type QueryCall } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  adminClient: null as unknown,
  checkSessionForUpload: vi.fn(),
  checkPhotoReuse: vi.fn(),
  recordFraudRejection: vi.fn(),
  appendAuditEvent: vi.fn(),
  readTestPhoto: vi.fn(),
  analyzePhoto: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/fraud/checks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fraud/checks")>()),
  checkSessionForUpload: mocks.checkSessionForUpload,
  checkPhotoReuse: mocks.checkPhotoReuse,
  recordFraudRejection: mocks.recordFraudRejection,
}));
vi.mock("@/lib/audit/chain", () => ({ appendAuditEvent: mocks.appendAuditEvent }));
vi.mock("@/lib/ai/grok", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/grok")>()),
  readTestPhoto: mocks.readTestPhoto,
}));
vi.mock("@/lib/ai/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/analyze")>()),
  analyzePhoto: mocks.analyzePhoto,
}));

const { POST } = await import("./route");

const REQUEST_ID = "12000000-0000-0000-0000-000000000001";
const PATIENT_ID = "11000000-0000-0000-0000-000000000001";
const PRACTICE_ID = "10000000-0000-0000-0000-000000000000";
const SUBMISSION_ID = "13000000-0000-0000-0000-000000000001";
const PHASH = "c3a1f09e5b7d2e44";

const ACTIVE = {
  ok: true,
  requestId: REQUEST_ID,
  patientId: PATIENT_ID,
  practiceId: PRACTICE_ID,
  expectedCode: "K7Q2",
  setting: "home",
};

function admin(opts: { insertError?: { code?: string; message?: string } } = {}) {
  const mock = mockSupabase({
    tables: {
      patients: {
        data: {
          id: PATIENT_ID,
          practice_id: PRACTICE_ID,
          can_get_pregnant: true,
          home_testing_allowed: true,
          phase: "during",
          treatment_start: "2026-06-01",
          language: "en",
        },
        error: null,
      },
      // An earlier, filled window: this is a monthly test, not the first pre-treatment one.
      windows: {
        data: {
          is_first_rx: true,
          opens_at: "2026-08-20T15:00:00.000Z",
          closes_at: "2026-08-27T15:00:00.000Z",
          filled_at: "2026-08-21T15:00:00.000Z",
          status: "filled",
        },
        error: null,
      },
      submissions: (calls: QueryCall[]) =>
        calls.some((c) => c.method === "insert")
          ? opts.insertError
            ? { data: null, error: opts.insertError }
            : { data: { id: SUBMISSION_ID }, error: null }
          : { data: null, error: null },
    },
  });
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  (mock.client.storage as unknown as { from: unknown }).from = vi.fn(() => ({ upload }));
  mocks.adminClient = mock.client;
  return { ...mock, upload };
}

function storedUpdate(queries: ReturnType<typeof admin>["queries"]) {
  const call = queries.submissions.flat().find((c) => c.method === "update");
  return call?.args[0] as { flags: string[]; status: string } | undefined;
}

function upload(token = "tok") {
  const form = new FormData();
  if (token) form.append("token", token);
  form.append("image", new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "test.jpg", { type: "image/jpeg" }));
  return POST(new Request("http://localhost/api/submissions", { method: "POST", body: form }));
}

beforeEach(() => {
  for (const fn of [
    mocks.checkSessionForUpload,
    mocks.checkPhotoReuse,
    mocks.recordFraudRejection,
    mocks.appendAuditEvent,
    mocks.readTestPhoto,
    mocks.analyzePhoto,
  ]) {
    fn.mockReset();
  }
  mocks.checkSessionForUpload.mockResolvedValue(ACTIVE);
  mocks.checkPhotoReuse.mockResolvedValue({ ok: true });
  mocks.recordFraudRejection.mockResolvedValue(null);
  mocks.appendAuditEvent.mockResolvedValue(null);
  mocks.readTestPhoto.mockResolvedValue({ result: "negative", confidence: 0.95, code_read: "K7Q2" });
  mocks.analyzePhoto.mockResolvedValue({
    result: "negative",
    controlLine: true,
    testLine: false,
    confidence: 0.95,
    phash: PHASH,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/submissions — link check (fraud check 1)", () => {
  it("400 without a token, before any check", async () => {
    admin();
    const res = await upload("");
    expect(res.status).toBe(400);
    expect(mocks.checkSessionForUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_link", null, "rejected_fraud"],
    ["session_not_started", REQUEST_ID, "rejected_fraud"],
    ["session_expired", REQUEST_ID, "expired"],
    ["already_submitted", REQUEST_ID, "rejected_fraud"],
  ] as const)("%s: 410, audited once, no insert and no AI call", async (reason, requestId, status) => {
    const db = admin();
    mocks.checkSessionForUpload.mockResolvedValue({ ok: false, reason, requestId });
    const res = await upload();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ submissionId: null, status, reason });
    expect(mocks.recordFraudRejection).toHaveBeenCalledTimes(1);
    expect(mocks.recordFraudRejection).toHaveBeenCalledWith(requestId, reason);
    expect(db.queries.submissions).toBeUndefined();
    expect(mocks.readTestPhoto).not.toHaveBeenCalled();
    expect(mocks.analyzePhoto).not.toHaveBeenCalled();
  });

  it("500 when the link cannot be checked, with no AI call", async () => {
    admin();
    mocks.checkSessionForUpload.mockRejectedValue(new Error("db down"));
    const res = await upload();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ submissionId: null, status: "error" });
    expect(mocks.readTestPhoto).not.toHaveBeenCalled();
  });

  it("a second upload that loses the insert race is already_submitted, before any AI call", async () => {
    admin({ insertError: { code: "23505", message: "duplicate key" } });
    const res = await upload();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ submissionId: null, status: "rejected_fraud", reason: "already_submitted" });
    expect(mocks.recordFraudRejection).toHaveBeenCalledWith(REQUEST_ID, "already_submitted");
    expect(mocks.readTestPhoto).not.toHaveBeenCalled();
    expect(mocks.analyzePhoto).not.toHaveBeenCalled();
  });

  it("any other insert error is still a 500", async () => {
    admin({ insertError: { code: "XX000", message: "boom" } });
    expect((await upload()).status).toBe(500);
    expect(mocks.recordFraudRejection).not.toHaveBeenCalled();
  });
});

describe("POST /api/submissions — accepted photo", () => {
  it("passes every check and records submission.received without the code", async () => {
    const db = admin();
    const res = await upload();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ submissionId: SUBMISSION_ID, received: true });
    expect(["ready_for_review", "needs_review"]).toContain(body.status);

    expect(mocks.checkPhotoReuse).toHaveBeenCalledWith(PHASH, { excludeSubmissionId: SUBMISSION_ID });
    expect(mocks.recordFraudRejection).not.toHaveBeenCalled();
    expect(db.upload).toHaveBeenCalledWith(`${PRACTICE_ID}/${SUBMISSION_ID}.jpg`, expect.anything(), expect.anything());

    const [, event] = mocks.appendAuditEvent.mock.calls[0];
    expect(event).toMatchObject({ actor: `patient:${PATIENT_ID}`, action: "submission.received", refId: SUBMISSION_ID });
    expect(event.payload.setting).toBe("home");
    expect(JSON.stringify(event)).not.toContain("K7Q2");
  });

  it("accepts a code read with different case and surrounding spaces", async () => {
    admin();
    mocks.readTestPhoto.mockResolvedValue({ result: "negative", confidence: 0.95, code_read: " k7q2 " });
    expect(await (await upload()).json()).toMatchObject({ received: true });
    expect(mocks.recordFraudRejection).not.toHaveBeenCalled();
  });
});

describe("POST /api/submissions — fraud checks 3 and 4", () => {
  it("a reused photo is rejected_fraud and audited", async () => {
    const db = admin();
    mocks.checkPhotoReuse.mockResolvedValue({
      ok: false,
      reason: "photo_already_used",
      matchedSubmissionId: "13000000-0000-0000-0000-000000000009",
      distance: 3,
    });
    const body = await (await upload()).json();
    expect(body).toMatchObject({ status: "rejected_fraud", received: false });
    expect(mocks.recordFraudRejection).toHaveBeenCalledWith(REQUEST_ID, "photo_already_used");
    expect(storedUpdate(db.queries)?.flags).toContain("photo_already_used");
  });

  it("a wrong code is rejected_fraud, audited, and no code appears in reasons or the audit log", async () => {
    const db = admin();
    mocks.readTestPhoto.mockResolvedValue({ result: "negative", confidence: 0.95, code_read: "AB12" });
    const body = await (await upload()).json();
    expect(body).toMatchObject({ status: "rejected_fraud", received: false });
    expect(mocks.recordFraudRejection).toHaveBeenCalledTimes(1);
    expect(mocks.recordFraudRejection).toHaveBeenCalledWith(REQUEST_ID, "code_missing_or_wrong");

    const stored = storedUpdate(db.queries)!;
    expect(stored.flags).toContain("code_missing_or_wrong");
    const leaked = JSON.stringify([body.reasons, stored.flags, mocks.appendAuditEvent.mock.calls]);
    expect(leaked).not.toContain("K7Q2");
    expect(leaked).not.toContain("AB12");
  });

  it("a missing code is rejected the same way", async () => {
    admin();
    mocks.readTestPhoto.mockResolvedValue({ result: "negative", confidence: 0.95, code_read: null });
    expect(await (await upload()).json()).toMatchObject({ status: "rejected_fraud" });
    expect(mocks.recordFraudRejection).toHaveBeenCalledWith(REQUEST_ID, "code_missing_or_wrong");
  });

  it("both failures are each audited", async () => {
    admin();
    mocks.checkPhotoReuse.mockResolvedValue({ ok: false, reason: "photo_already_used", matchedSubmissionId: "x", distance: 0 });
    mocks.readTestPhoto.mockResolvedValue({ result: "negative", confidence: 0.95, code_read: "AB12" });
    await upload();
    expect(mocks.recordFraudRejection.mock.calls).toEqual([
      [REQUEST_ID, "photo_already_used"],
      [REQUEST_ID, "code_missing_or_wrong"],
    ]);
  });

  it("a failed reuse check flags for the prescriber instead of blocking", async () => {
    const db = admin();
    mocks.checkPhotoReuse.mockRejectedValue(new Error("db down"));
    const body = await (await upload()).json();
    expect(body.received).toBe(true);
    expect(storedUpdate(db.queries)?.flags).toContain("reuse_check_unavailable");
    expect(mocks.recordFraudRejection).not.toHaveBeenCalled();
  });

  it("without Grok the code is not checked, and the submission needs review", async () => {
    admin();
    mocks.readTestPhoto.mockRejectedValue(new Error("grok down"));
    const body = await (await upload()).json();
    expect(body).toMatchObject({ status: "needs_review", received: true });
    expect(mocks.recordFraudRejection).not.toHaveBeenCalled();
  });
});
