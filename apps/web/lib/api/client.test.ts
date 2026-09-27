import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveRefillRequest,
  declineRefillRequest,
  enrollPatient,
  generateEnrollmentCode,
  getPatientCycle,
  getPatientTestLink,
  getPortalStatuses,
  getQueue,
  isTestPath,
  issueTestLink,
  listRefillRequests,
  markPickedUp,
  requestRefill,
  resendTestLink,
  setHomeTesting,
  startTestSession,
  submitReview,
  submitTestPhoto,
} from "./client";

let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body?: unknown) {
  return Promise.resolve(
    new Response(body === undefined ? "<!doctype html>not found" : JSON.stringify(body), {
      status,
      headers: { "content-type": body === undefined ? "text/html" : "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const CYCLE = {
  id: "c1",
  status: "approved",
  timestamps: { requested: "2026-09-27T10:00:00Z", approved: "2026-09-27T11:00:00Z" },
  emailStatus: "sent",
  pickupDeadline: null,
  declineReason: null,
  rejectReason: null,
  testLinkAvailable: true,
  canRequestAgain: false,
};

describe("common error mapping", () => {
  it("maps a thrown fetch to network_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await getPatientCycle()).toEqual({ ok: false, error: { code: "network_error", status: 0 } });
  });

  it("maps 401 to unauthenticated and 403 to not_a_clinician", async () => {
    fetchMock.mockReturnValueOnce(reply(401, { error: "unauthenticated" })).mockReturnValueOnce(reply(403, { error: "not_a_clinician" }));
    expect(await listRefillRequests({ status: "requested" })).toEqual({ ok: false, error: { code: "unauthenticated", status: 401 } });
    expect(await listRefillRequests({ status: "requested" })).toEqual({ ok: false, error: { code: "not_a_clinician", status: 403 } });
  });

  it("maps a 404 with no JSON (route not built yet) to not_available", async () => {
    fetchMock.mockReturnValue(reply(404));
    expect(await getPortalStatuses()).toEqual({ ok: false, error: { code: "not_available", status: 404 } });
  });

  it("maps 429 to rate_limited and unknown 5xx to server_error", async () => {
    fetchMock.mockReturnValueOnce(reply(429, {})).mockReturnValueOnce(reply(500, { error: "weird" }));
    expect(await getQueue()).toEqual({ ok: false, error: { code: "rate_limited", status: 429 } });
    expect(await getQueue()).toEqual({ ok: false, error: { code: "server_error", status: 500 } });
  });

  it("treats a 200 with the wrong shape as a server error", async () => {
    fetchMock.mockReturnValue(reply(200, { nope: true }));
    expect(await getQueue()).toEqual({ ok: false, error: { code: "server_error", status: 200 } });
  });
});

describe("patient portal endpoints", () => {
  it("enroll: success and every error code", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { patientId: "p1" }));
    expect(await enrollPatient("K4M9TQ2P")).toEqual({ ok: true, data: { patientId: "p1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/patient/enroll",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ enrollmentCode: "K4M9TQ2P" }) }),
    );
    for (const [status, code] of [
      [404, "invalid_code"],
      [410, "expired_code"],
      [409, "already_enrolled"],
    ] as const) {
      fetchMock.mockReturnValueOnce(reply(status, { error: code }));
      expect(await enrollPatient("x")).toEqual({ ok: false, error: { code, status } });
    }
  });

  it("cycle: a cycle, no cycle, and not_enrolled", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { cycle: CYCLE }));
    expect(await getPatientCycle()).toEqual({ ok: true, data: { cycle: CYCLE } });
    fetchMock.mockReturnValueOnce(reply(200, { cycle: null }));
    expect(await getPatientCycle()).toEqual({ ok: true, data: { cycle: null } });
    fetchMock.mockReturnValueOnce(reply(403, { error: "not_enrolled" }));
    expect(await getPatientCycle()).toEqual({ ok: false, error: { code: "not_enrolled", status: 403 } });
  });

  it("request refill: success and cycle_already_open", async () => {
    fetchMock.mockReturnValueOnce(reply(201, { requestId: "r1" }));
    expect(await requestRefill()).toEqual({ ok: true, data: { requestId: "r1" } });
    fetchMock.mockReturnValueOnce(reply(409, { error: "cycle_already_open" }));
    expect(await requestRefill()).toEqual({ ok: false, error: { code: "cycle_already_open", status: 409 } });
  });

  it("test link: accepts only a same-origin /t/ path", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { testPath: "/t/abc_DEF-123" }));
    expect(await getPatientTestLink()).toEqual({ ok: true, data: { testPath: "/t/abc_DEF-123" } });
    fetchMock.mockReturnValueOnce(reply(200, { testPath: "https://evil.test/t/abc" }));
    expect((await getPatientTestLink()).ok).toBe(false);
    fetchMock.mockReturnValueOnce(reply(409, { error: "no_test_link" }));
    expect(await getPatientTestLink()).toEqual({ ok: false, error: { code: "no_test_link", status: 409 } });
  });

  it("isTestPath rejects anything but /t/<token>", () => {
    expect(isTestPath("/t/abc")).toBe(true);
    for (const bad of ["//evil.test/t/a", "/t/", "/t/a/b", "/portal", "https://x/t/a", "/t/a?x=1"]) expect(isTestPath(bad)).toBe(false);
  });
});

describe("refill request endpoints", () => {
  it("lists with status and emailStatus filters", async () => {
    fetchMock.mockReturnValue(reply(200, []));
    await listRefillRequests({ status: "approved", emailStatus: "failed" });
    expect(fetchMock).toHaveBeenCalledWith("/api/refill-requests?status=approved&emailStatus=failed", { cache: "no-store" });
  });

  it("approve: each email status, not_pending and not_found", async () => {
    for (const emailStatus of ["sent", "failed", "disabled"] as const) {
      fetchMock.mockReturnValueOnce(reply(200, { emailStatus }));
      expect(await approveRefillRequest("r1")).toEqual({ ok: true, data: { emailStatus } });
    }
    expect(fetchMock).toHaveBeenCalledWith("/api/refill-requests/r1/approve", { method: "POST" });
    fetchMock.mockReturnValueOnce(reply(409, { error: "not_pending" }));
    expect(await approveRefillRequest("r1")).toEqual({ ok: false, error: { code: "not_pending", status: 409 } });
    fetchMock.mockReturnValueOnce(reply(404, { error: "not_found" }));
    expect(await approveRefillRequest("r1")).toEqual({ ok: false, error: { code: "not_found", status: 404 } });
  });

  it("decline sends the reason; resend returns the email status", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true }));
    expect(await declineRefillRequest("r1", "See us first")).toEqual({ ok: true, data: { ok: true } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: "See us first" });
    fetchMock.mockReturnValueOnce(reply(400, { error: "reason_required" }));
    expect(await declineRefillRequest("r1", "")).toEqual({ ok: false, error: { code: "reason_required", status: 400 } });
    fetchMock.mockReturnValueOnce(reply(200, { emailStatus: "sent" }));
    expect(await resendTestLink("r1")).toEqual({ ok: true, data: { emailStatus: "sent" } });
    fetchMock.mockReturnValueOnce(reply(409, { error: "not_resendable" }));
    expect(await resendTestLink("r1")).toEqual({ ok: false, error: { code: "not_resendable", status: 409 } });
  });

  it("enrollment code: success, already_enrolled", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { code: "K4M9-TQ2P", expiresAt: "2026-09-30T00:00:00Z" }));
    expect(await generateEnrollmentCode("p1")).toEqual({ ok: true, data: { code: "K4M9-TQ2P", expiresAt: "2026-09-30T00:00:00Z" } });
    fetchMock.mockReturnValueOnce(reply(409, { error: "already_enrolled" }));
    expect(await generateEnrollmentCode("p1")).toEqual({ ok: false, error: { code: "already_enrolled", status: 409 } });
  });
});

describe("existing endpoints", () => {
  it("issue link: success and the home refusal reason", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { requestId: "r", link: "https://x/t/a", expiresAt: "e" }));
    expect(await issueTestLink({ patientId: "p", setting: "home" })).toEqual({
      ok: true,
      data: { requestId: "r", link: "https://x/t/a", expiresAt: "e" },
    });
    fetchMock.mockReturnValueOnce(reply(409, { error: "home_testing_not_allowed", reason: "pre_treatment" }));
    expect(await issueTestLink({ patientId: "p", setting: "home" })).toEqual({
      ok: false,
      error: { code: "home_testing_not_allowed", status: 409 },
      refusal: "pre_treatment",
    });
  });

  it("home testing: audit_failed still reports the change", async () => {
    fetchMock.mockReturnValueOnce(reply(500, { error: "audit_failed", changed: true }));
    expect(await setHomeTesting("p", true)).toEqual({ ok: false, error: { code: "audit_failed", status: 500 }, changed: true });
  });

  it("review: saved-with-error keeps reviewRecorded", async () => {
    fetchMock.mockReturnValueOnce(reply(500, { error: "photo_delete_failed", reviewRecorded: true }));
    expect(await submitReview("s", "approved")).toEqual({
      ok: false,
      error: { code: "photo_delete_failed", status: 500 },
      reviewRecorded: true,
    });
  });

  it("mark picked up: maps the route's status codes", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, daysToFill: 2 }));
    expect(await markPickedUp("w")).toEqual({ ok: true, data: { alreadyPickedUp: false, daysToFill: 2 } });
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, alreadyFilled: true }));
    expect(await markPickedUp("w")).toEqual({ ok: true, data: { alreadyPickedUp: true, daysToFill: null } });
    for (const [status, code] of [
      [409, "not_open"],
      [404, "not_found"],
      [400, "invalid_request"],
    ] as const) {
      fetchMock.mockReturnValueOnce(reply(status, { ok: false, reason: "some sentence" }));
      expect(await markPickedUp("w")).toEqual({ ok: false, error: { code, status } });
    }
  });
});

describe("test link start", () => {
  it("returns the code, the session end and an optional code expiry", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, state: "active", challengeCode: "K7Q2", sessionEndsAt: "s" }));
    expect(await startTestSession("tok")).toEqual({ ok: true, data: { challengeCode: "K7Q2", sessionEndsAt: "s", codeExpiresAt: null } });
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, challengeCode: "K7Q2", sessionEndsAt: "s", codeExpiresAt: "c" }));
    expect(await startTestSession("tok")).toEqual({ ok: true, data: { challengeCode: "K7Q2", sessionEndsAt: "s", codeExpiresAt: "c" } });
  });

  it.each([
    [404, { ok: false, state: "invalid" }, "invalid"],
    [409, { ok: false, state: "submitted" }, "submitted"],
    [401, { error: "not_logged_in" }, "not_logged_in"],
    [401, {}, "not_logged_in"],
    [403, { error: "wrong_patient" }, "wrong_patient"],
    [403, {}, "wrong_patient"],
    [410, { error: "invalidated" }, "invalidated"],
    [410, { error: "expired" }, "expired"],
    [410, { error: "already_used" }, "already_used"],
    [429, { ok: false, state: "rate_limited" }, "rate_limited"],
    [500, { ok: false, state: "error" }, "server_error"],
  ])("HTTP %i %j → %s", async (status, body, code) => {
    fetchMock.mockReturnValueOnce(reply(status, body));
    expect(await startTestSession("tok")).toEqual({ ok: false, error: { code, status } });
  });

  it("never puts the token or code into an error", async () => {
    fetchMock.mockReturnValueOnce(reply(409, { ok: false, state: "session_expired", challengeCode: "K7Q2" }));
    expect(JSON.stringify(await startTestSession("secret-token"))).not.toMatch(/K7Q2|secret-token/);
  });
});

describe("photo submission", () => {
  it("received, and a pipeline reason as the error code", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { submissionId: "s", status: "ready_for_review", received: true, reasons: [] }));
    expect(await submitTestPhoto("tok", new Blob(["x"], { type: "image/jpeg" }))).toEqual({ ok: true, data: { received: true, reason: null } });
    fetchMock.mockReturnValueOnce(reply(410, { submissionId: null, status: "expired", reason: "session_expired" }));
    expect(await submitTestPhoto("tok", new Blob(["x"]))).toEqual({ ok: false, error: { code: "session_expired", status: 410 } });
  });
});
