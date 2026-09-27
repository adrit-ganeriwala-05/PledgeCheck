// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isMocked, mockMode } from "../mode";

import * as mocks from "./index";
import { STORAGE_KEY } from "./store";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("mock mode switch", () => {
  it("is off by default", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKS", "");
    expect(mockMode()).toBe("off");
    expect(isMocked("patientCycle")).toBe(false);
  });

  it("=1 mocks nothing, because every endpoint is live", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKS", "1");
    // The mode still exists for the next endpoint built UI-first; today it mocks nothing.
    for (const endpoint of ["patientCycle", "refillApprove", "queue", "auth"] as const) {
      expect(isMocked(endpoint)).toBe(false);
    }
  });

  it("=all mocks everything", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKS", "all");
    expect(isMocked("queue")).toBe(true);
    expect(isMocked("auth")).toBe(true);
  });

  it.each(["1", "all"])("stays off in production even with NEXT_PUBLIC_API_MOCKS=%s", (flag) => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKS", flag);
    vi.stubEnv("NODE_ENV", "production");
    expect(mockMode()).toBe("off");
    expect(isMocked("patientCycle")).toBe(false);
    expect(isMocked("queue")).toBe(false);
  });

  it("the client calls the real endpoint when mocks are off", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKS", "1");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ clinics: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { listClinics } = await import("../client");
    await listClinics();
    expect(fetchMock).toHaveBeenCalledWith("/api/portal/clinics", { cache: "no-store" });
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("mock adapter flow", () => {
  beforeEach(() => {
    // Node's own experimental localStorage global shadows jsdom's; use a plain one.
    vi.stubGlobal("localStorage", memoryStorage());
    mocks.resetMockData();
  });

  it("walks a cycle from request to pickup", async () => {
    expect((await mocks.getPatientCycle()).ok).toBe(false); // signed out
    await mocks.patientSignIn("demo@example.test", "password123");
    expect(await mocks.getPatientCycle()).toEqual({ ok: true, data: { cycle: null } });

    const req = await mocks.requestRefill();
    expect(req.ok).toBe(true);
    expect(await mocks.requestRefill()).toEqual({ ok: false, error: { code: "already_pending", status: 409 } });

    const id = req.ok ? req.data.requestId : "";
    expect(await mocks.approveRefillRequest(id)).toEqual({ ok: true, data: { emailStatus: "sent" } });
    const approved = await mocks.getPatientCycle();
    expect(approved.ok && approved.data.cycle?.status).toBe("approved");

    // The link reaches the patient by email, so the test takes it the way the clinic would.
    const issued = await mocks.issueTestLink({ patientId: "mock-patient-1042", setting: "home" });
    const token = issued.ok ? new URL(issued.data.link).pathname.slice(3) : "";
    const started = await mocks.startTestSession(token);
    expect(started.ok).toBe(true);
    expect(await mocks.submitTestPhoto(token, new Blob(["x"]))).toEqual({ ok: true, data: { received: true, reason: null } });

    const queue = await mocks.getQueue();
    const card = queue.ok ? queue.data.cards.find((c) => c.patient.pseudonym === "PT-1042") : undefined;
    expect(card?.grok.code).toBe(started.ok ? started.data.challengeCode : "");

    expect((await mocks.submitReview(card!.submissionId, "approved")).ok).toBe(true);
    const open = await mocks.getPatientCycle();
    expect(open.ok && open.data.cycle?.status).toBe("window_open");
    expect(open.ok && open.data.cycle?.pickupDeadline).toBeTruthy();

    const windowRow = mocks.mockWindows().find((w) => w.pseudonym === "PT-1042");
    expect((await mocks.markPickedUp(windowRow!.id)).ok).toBe(true);
    const done = await mocks.getPatientCycle();
    expect(done.ok && done.data.cycle?.status).toBe("picked_up");
  });

  it("stores no email address, token, link or challenge code", async () => {
    await mocks.patientSignUp("someone@example.test", "password123");
    await mocks.enrollPatient("mock-practice-1");
    const req = await mocks.requestRefill();
    await mocks.approveRefillRequest(req.ok ? req.data.requestId : "");
    const issued = await mocks.issueTestLink({ patientId: "mock-patient-1042", setting: "home" });
    const link = issued.ok ? issued.data.link : "";
    const token = issued.ok ? new URL(link).pathname.slice(3) : "";
    const started = await mocks.startTestSession(token);
    await mocks.submitTestPhoto(token, new Blob(["x"]));

    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    expect(stored).not.toContain("someone@example.test");
    expect(stored).not.toContain("@");
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(link);
    expect(stored).not.toMatch(new RegExp(`"${started.ok ? started.data.challengeCode : "????"}"`));
  });

  it("reaches every error the screens handle", async () => {
    expect(await mocks.patientSignUp("x@taken.test", "password123")).toEqual({ ok: false, error: { code: "email_taken", status: 400 } });
    expect(await mocks.patientSignUp("x@example.test", "short")).toEqual({ ok: false, error: { code: "weak_password", status: 422 } });
    expect(await mocks.patientSignUp("confirm@example.test", "password123")).toEqual({ ok: true, data: { needsEmailConfirmation: true } });
    expect(await mocks.patientSignIn("x@example.test", "wrong")).toEqual({ ok: false, error: { code: "bad_credentials", status: 400 } });

    await mocks.patientSignUp("new@example.test", "password123");
    expect(await mocks.enrollPatient("not-a-practice")).toEqual({ ok: false, error: { code: "unknown_practice", status: 404 } });
    expect((await mocks.enrollPatient("mock-practice-1")).ok).toBe(true);
    expect(await mocks.enrollPatient("mock-practice-1")).toEqual({ ok: false, error: { code: "already_enrolled", status: 409 } });

    expect(await mocks.approveRefillRequest("mock-req-4477")).toEqual({ ok: false, error: { code: "already_decided", status: 409 } });
    expect(await mocks.approveRefillRequest("mock-req-3310")).toEqual({ ok: true, data: { emailStatus: "failed" } });
    // PT-6604 has no address on file, so the mailer was never asked.
    expect(await mocks.approveRefillRequest("mock-req-6604")).toEqual({ ok: true, data: { emailStatus: "disabled" } });

    for (const [token, code] of [
      ["mock-invalidated", "invalidated"],
      ["mock-expired", "expired"],
      ["mock-already-used", "already_used"],
      ["mock-wrong-patient", "wrong_patient"],
    ] as const) {
      const result = await mocks.startTestSession(token);
      expect(result.ok === false && result.error.code).toBe(code);
    }
    await mocks.patientSignOut();
    const signedOut = await mocks.startTestSession("mock-anything");
    expect(signedOut.ok === false && signedOut.error.code).toBe("not_logged_in");
  });

  it("never reveals a challenge code before Start", async () => {
    await mocks.patientSignIn("demo@example.test", "password123");
    const cycle = await mocks.getPatientCycle();
    expect(JSON.stringify(cycle)).not.toMatch(/challengeCode|"code"/);
  });
});
