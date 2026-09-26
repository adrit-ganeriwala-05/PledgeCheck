import { beforeEach, describe, expect, it, vi } from "vitest";

import { phashDb, phashWithBits } from "@/test/phash-db";
import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({ adminClient: null as unknown, appendAuditEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { checkChallengeCode, checkPhotoReuse, checkSessionForUpload, recordFraudRejection } = await import("./checks");
const { PhashFormatError } = await import("./reuse");

const NOW = new Date("2026-09-26T15:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const REQUEST_ID = "12000000-0000-0000-0000-000000000001";
const PATIENT_ID = "11000000-0000-0000-0000-000000000001";
const PRACTICE_ID = "10000000-0000-0000-0000-000000000000";

function session(opts: { request?: Record<string, unknown> | null; submission?: { id: string } | null }) {
  const request =
    opts.request === undefined
      ? { id: REQUEST_ID, patient_id: PATIENT_ID, challenge_code: "K7Q2", setting: "home", expires_at: at(600), used_at: at(-5) }
      : opts.request;
  mocks.adminClient = mockSupabase({
    tables: {
      test_requests: { data: request, error: null },
      submissions: { data: opts.submission ?? null, error: null },
      patients: { data: { practice_id: PRACTICE_ID }, error: null },
    },
  }).client;
}

beforeEach(() => {
  mocks.appendAuditEvent.mockReset();
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
});

describe("checkSessionForUpload", () => {
  it("ok during an active session, with ids and the expected code", async () => {
    session({});
    expect(await checkSessionForUpload("tok", NOW)).toEqual({
      ok: true,
      requestId: REQUEST_ID,
      patientId: PATIENT_ID,
      practiceId: PRACTICE_ID,
      expectedCode: "K7Q2",
      setting: "home",
    });
  });

  it("invalid_link for an unknown token", async () => {
    session({ request: null });
    expect(await checkSessionForUpload("tok", NOW)).toEqual({ ok: false, reason: "invalid_link", requestId: null });
  });

  it("session_not_started before Start (strict, unlike the interim consumeRequest)", async () => {
    session({ request: { id: REQUEST_ID, patient_id: PATIENT_ID, challenge_code: "K7Q2", setting: "home", expires_at: at(600), used_at: null } });
    expect(await checkSessionForUpload("tok", NOW)).toEqual({ ok: false, reason: "session_not_started", requestId: REQUEST_ID });
  });

  it("session_not_started for a link that expired unstarted", async () => {
    session({ request: { id: REQUEST_ID, patient_id: PATIENT_ID, challenge_code: "K7Q2", setting: "home", expires_at: at(-1), used_at: null } });
    expect(await checkSessionForUpload("tok", NOW)).toEqual({ ok: false, reason: "session_not_started", requestId: REQUEST_ID });
  });

  it("session_expired exactly at the deadline", async () => {
    session({ request: { id: REQUEST_ID, patient_id: PATIENT_ID, challenge_code: "K7Q2", setting: "home", expires_at: at(600), used_at: at(-40) } });
    expect(await checkSessionForUpload("tok", NOW)).toEqual({ ok: false, reason: "session_expired", requestId: REQUEST_ID });
    session({ request: { id: REQUEST_ID, patient_id: PATIENT_ID, challenge_code: "K7Q2", setting: "home", expires_at: at(600), used_at: at(-39.99) } });
    expect(await checkSessionForUpload("tok", NOW)).toMatchObject({ ok: true });
  });

  it("already_submitted when a submission row exists", async () => {
    session({ submission: { id: "s1" } });
    expect(await checkSessionForUpload("tok", NOW)).toEqual({ ok: false, reason: "already_submitted", requestId: REQUEST_ID });
  });
});

describe("checkChallengeCode", () => {
  it.each([
    ["k7q2", { ok: true }],
    [" K7 Q2 ", { ok: true }],
    ["K7Q3", { ok: false, reason: "code_missing_or_wrong" }],
    ["", { ok: false, reason: "code_missing_or_wrong" }],
    [null, { ok: false, reason: "code_missing_or_wrong" }],
  ])("read %j", (read, expected) => {
    expect(checkChallengeCode("K7Q2", read)).toEqual(expected);
  });
});

describe("checkPhotoReuse", () => {
  const ZERO = "0000000000000000";

  it("flags distance 7 and passes distance 8", async () => {
    mocks.adminClient = phashDb([{ id: "s1", phash: phashWithBits(7) }]).client;
    expect(await checkPhotoReuse(ZERO)).toEqual({ ok: false, reason: "photo_already_used", matchedSubmissionId: "s1", distance: 7 });
    mocks.adminClient = phashDb([{ id: "s1", phash: phashWithBits(8) }]).client;
    expect(await checkPhotoReuse(ZERO)).toEqual({ ok: true });
  });

  it("honors excludeSubmissionId", async () => {
    mocks.adminClient = phashDb([{ id: "self", phash: ZERO }]).client;
    expect(await checkPhotoReuse(ZERO, { excludeSubmissionId: "self" })).toEqual({ ok: true });
  });

  it("paginates past 1000 rows", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `s${i}`, phash: "ffffffffffffffff" }));
    rows[1499] = { id: "late", phash: ZERO };
    const db = phashDb(rows);
    mocks.adminClient = db.client;
    expect(await checkPhotoReuse(ZERO)).toMatchObject({ ok: false, matchedSubmissionId: "late", distance: 0 });
    expect(db.ranges).toHaveLength(2);
  });

  it("throws on a malformed phash", async () => {
    mocks.adminClient = phashDb([]).client;
    await expect(checkPhotoReuse("not-a-hash")).rejects.toBeInstanceOf(PhashFormatError);
  });
});

describe("recordFraudRejection", () => {
  it("writes submission.rejected_fraud with { reason } only", async () => {
    await recordFraudRejection(REQUEST_ID, "photo_already_used");
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith({
      actor: "system",
      action: "submission.rejected_fraud",
      refId: REQUEST_ID,
      payload: { reason: "photo_already_used" },
    });
  });

  it("accepts a null request id for an unknown link", async () => {
    await recordFraudRejection(null, "invalid_link");
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith({
      actor: "system",
      action: "submission.rejected_fraud",
      refId: null,
      payload: { reason: "invalid_link" },
    });
  });

  it("is best effort: logs and returns null when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.appendAuditEvent.mockRejectedValue(new Error("down"));
    await expect(recordFraudRejection(REQUEST_ID, "session_expired")).resolves.toBeNull();
  });

  it("refuses an arbitrary reason string (which could carry a code or hash)", async () => {
    await expect(recordFraudRejection(REQUEST_ID, "read K7Q3 expected K7Q2" as never)).rejects.toThrow();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
