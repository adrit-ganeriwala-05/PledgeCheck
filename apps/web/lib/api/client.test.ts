import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cycle and the refill inbox are server actions, not fetches, so they are mocked at
// the module boundary rather than through fetch.
const serverReads = vi.hoisted(() => ({ readPatientCycle: vi.fn(), readRefillRequests: vi.fn() }));
vi.mock("./server-reads", () => serverReads);

import {
  approveRefillRequest,
  declineRefillRequest,
  enrollPatient,
  getPatientCycle,
  getQueue,
  issueTestLink,
  listClinics,
  listRefillRequests,
  markPickedUp,
  requestRefill,
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
  canRequestAgain: false,
};

describe("common error mapping", () => {
  it("maps a thrown fetch to network_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    expect(await requestRefill()).toEqual({ ok: false, error: { code: "network_error", status: 0 } });
  });

  it("maps 401 to unauthenticated and 403 to not_a_clinician", async () => {
    fetchMock.mockReturnValueOnce(reply(401, { error: "unauthenticated" })).mockReturnValueOnce(reply(403, { error: "not_a_clinician" }));
    expect(await getQueue()).toEqual({ ok: false, error: { code: "unauthenticated", status: 401 } });
    expect(await getQueue()).toEqual({ ok: false, error: { code: "not_a_clinician", status: 403 } });
  });

  it("maps a 404 with no JSON (route not built yet) to not_available", async () => {
    fetchMock.mockReturnValue(reply(404));
    expect(await listClinics()).toEqual({ ok: false, error: { code: "not_available", status: 404 } });
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
  it("clinics: the public list the signup form offers", async () => {
    const clinics = [{ id: "pr1", name: "Peachtree Dermatology", prescribers: ["Dr. Rivera"] }];
    fetchMock.mockReturnValueOnce(reply(200, { clinics }));
    expect(await listClinics()).toEqual({ ok: true, data: { clinics } });
    expect(fetchMock).toHaveBeenCalledWith("/api/portal/clinics", { cache: "no-store" });
  });

  it("enroll: sends a practiceId and maps every error code", async () => {
    fetchMock.mockReturnValueOnce(reply(201, { id: "p1", pseudonym: "PT-9001" }));
    expect(await enrollPatient("pr1")).toEqual({ ok: true, data: { patientId: "p1", pseudonym: "PT-9001" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/portal/enroll",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ practiceId: "pr1" }) }),
    );
    for (const [status, code] of [
      [404, "unknown_practice"],
      [409, "already_enrolled"],
      [400, "invalid_request"],
    ] as const) {
      fetchMock.mockReturnValueOnce(reply(status, { error: code }));
      expect(await enrollPatient("pr1")).toEqual({ ok: false, error: { code, status } });
    }
  });

  it("cycle: passes the server action's answer straight through", async () => {
    serverReads.readPatientCycle.mockResolvedValueOnce({ ok: true, data: { cycle: CYCLE } });
    expect(await getPatientCycle()).toEqual({ ok: true, data: { cycle: CYCLE } });
    serverReads.readPatientCycle.mockResolvedValueOnce({ ok: false, error: { code: "not_enrolled", status: 403 } });
    expect(await getPatientCycle()).toEqual({ ok: false, error: { code: "not_enrolled", status: 403 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cycle: a thrown action reads as a network error, not a crash", async () => {
    serverReads.readPatientCycle.mockRejectedValueOnce(new Error("offline"));
    expect(await getPatientCycle()).toEqual({ ok: false, error: { code: "network_error", status: 0 } });
  });

  it("request refill: success and already_pending", async () => {
    fetchMock.mockReturnValueOnce(reply(201, { id: "r1", createdAt: "2026-09-27T00:00:00Z" }));
    expect(await requestRefill()).toEqual({ ok: true, data: { requestId: "r1", createdAt: "2026-09-27T00:00:00Z" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/portal/refills", expect.objectContaining({ method: "POST" }));
    fetchMock.mockReturnValueOnce(reply(409, { error: "already_pending" }));
    expect(await requestRefill()).toEqual({ ok: false, error: { code: "already_pending", status: 409 } });
  });
});

describe("refill request endpoints", () => {
  it("lists through the server action", async () => {
    serverReads.readRefillRequests.mockResolvedValueOnce({ ok: true, data: [] });
    expect(await listRefillRequests({ status: "requested" })).toEqual({ ok: true, data: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("approve: posts one decision and reads `emailed`", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, decision: "linked", emailed: true }));
    expect(await approveRefillRequest("r1", true)).toEqual({ ok: true, data: { emailStatus: "sent" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/refills/r1/decision",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "approve", setting: "home" }) }),
    );
  });

  it("approve: a patient with no address reads as disabled, not failed", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, decision: "linked", emailed: false }));
    expect(await approveRefillRequest("r1", false)).toEqual({ ok: true, data: { emailStatus: "disabled" } });
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, decision: "linked", emailed: false }));
    expect(await approveRefillRequest("r1", true)).toEqual({ ok: true, data: { emailStatus: "failed" } });
  });

  it("approve: the decision route's own error codes", async () => {
    for (const [status, code] of [
      [409, "already_decided"],
      [404, "not_found"],
      [409, "home_testing_not_allowed"],
      [500, "issue_failed"],
    ] as const) {
      fetchMock.mockReturnValueOnce(reply(status, { error: code }));
      expect(await approveRefillRequest("r1", true)).toEqual({ ok: false, error: { code, status } });
    }
  });

  it("decline sends the decision and the reason together", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { ok: true, decision: "declined" }));
    expect(await declineRefillRequest("r1", "See us first")).toEqual({ ok: true, data: { ok: true } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ decision: "decline", reason: "See us first" });
    fetchMock.mockReturnValueOnce(reply(400, { error: "invalid_request" }));
    expect(await declineRefillRequest("r1", "")).toEqual({ ok: false, error: { code: "invalid_request", status: 400 } });
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
