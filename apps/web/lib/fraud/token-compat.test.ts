// checkToken / consumeRequest: the older interface, kept for compatibility, on top of the
// session model. Strict by default; lenient-mode behavior is tested via a switch.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase, type QueryCall } from "@/test/supabase-mock";

const { appendAuditEvent, mode } = vi.hoisted(() => ({ appendAuditEvent: vi.fn(), mode: { lenient: false } }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent }));
// The real constant is read below; token.ts sees this switch so both modes stay tested.
vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return {
    ...actual,
    get ALLOW_UPLOAD_WITHOUT_START() {
      return mode.lenient;
    },
  };
});

const { checkToken, consumeRequest, hashToken } = await import("./token");
const { ALLOW_UPLOAD_WITHOUT_START } = await vi.importActual<typeof import("./session")>("./session");

const NOW = new Date("2026-09-26T15:00:00.000Z");
const REQUEST_ID = "12000000-0000-0000-0000-000000000001";
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

type Opts = {
  request?: Record<string, unknown> | null;
  submission?: { id: string } | null;
  claimed?: { id: string }[];
};

function db(opts: Opts = {}) {
  const request =
    opts.request === undefined
      ? {
          id: REQUEST_ID,
          patient_id: "11000000-0000-0000-0000-000000000001",
          challenge_code: "K7Q2",
          setting: "home",
          expires_at: at(600),
          used_at: null,
        }
      : opts.request;
  const mock = mockSupabase({
    tables: {
      test_requests: (calls: QueryCall[]) =>
        calls.some((c) => c.method === "update")
          ? { data: opts.claimed ?? [{ id: REQUEST_ID }], error: null }
          : { data: request, error: null },
      submissions: { data: opts.submission ?? null, error: null },
    },
  });
  return { client: mock.client as unknown as SupabaseClient, queries: mock.queries };
}

const updates = (q: ReturnType<typeof db>["queries"]) =>
  (q.test_requests ?? []).filter((calls) => calls.some((c) => c.method === "update"));

beforeEach(() => {
  appendAuditEvent.mockReset();
  appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
});

afterEach(() => {
  mode.lenient = false;
});

describe("mode", () => {
  it("is strict: the capture page calls Start, so uploads need an active session", () => {
    expect(ALLOW_UPLOAD_WITHOUT_START).toBe(false);
  });
});

describe("checkToken(db, token, now)", () => {
  it("looks up by hash and returns not_found for an unknown token", async () => {
    const d = db({ request: null });
    expect(await checkToken(d.client, "tok", NOW)).toEqual({ ok: false, failure: "not_found" });
    expect(d.queries.test_requests[0]).toContainEqual({ method: "eq", args: ["token_hash", hashToken("tok")] });
  });

  it("is ok for a not-yet-started link (ready)", async () => {
    const result = await checkToken(db().client, "tok", NOW);
    expect(result).toMatchObject({ ok: true, request: { id: REQUEST_ID, challenge_code: "K7Q2", used_at: null } });
  });

  it("is ok during an active session", async () => {
    const d = db({ request: { id: REQUEST_ID, patient_id: "p", challenge_code: "K7Q2 ", setting: "home", expires_at: at(600), used_at: at(-10) } });
    expect(await checkToken(d.client, "tok", NOW)).toMatchObject({ ok: true, request: { challenge_code: "K7Q2" } });
  });

  it("expired for an unstarted link past expires_at, and for an expired session", async () => {
    const linkExpired = db({ request: { id: REQUEST_ID, patient_id: "p", challenge_code: "K7Q2", setting: "home", expires_at: at(0), used_at: null } });
    expect(await checkToken(linkExpired.client, "tok", NOW)).toEqual({ ok: false, failure: "expired" });
    const sessionExpired = db({ request: { id: REQUEST_ID, patient_id: "p", challenge_code: "K7Q2", setting: "home", expires_at: at(600), used_at: at(-40) } });
    expect(await checkToken(sessionExpired.client, "tok", NOW)).toEqual({ ok: false, failure: "expired" });
  });

  it("already_used once a photo was submitted", async () => {
    const d = db({ submission: { id: "s1" } });
    expect(await checkToken(d.client, "tok", NOW)).toEqual({ ok: false, failure: "already_used" });
  });
});

describe("consumeRequest(db, requestId, now)", () => {
  it("claims an active session without touching used_at", async () => {
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: at(-5) } });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(true);
    expect(updates(d.queries)).toHaveLength(0);
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it("strict: refuses a never-started session without touching used_at", async () => {
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: null } });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(false);
    expect(updates(d.queries)).toHaveLength(0);
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it("lenient: starts a never-started session at upload, once, and audits it", async () => {
    mode.lenient = true;
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: null } });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(true);
    const [update] = updates(d.queries);
    expect(update).toContainEqual({ method: "update", args: [{ used_at: NOW.toISOString() }] });
    expect(update).toContainEqual({ method: "is", args: ["used_at", null] });
    expect(appendAuditEvent).toHaveBeenCalledWith({
      actor: "system",
      action: "session.started",
      refId: REQUEST_ID,
      payload: { via: "upload" },
    });
  });

  it("lenient: false when another upload already claimed the unstarted link", async () => {
    mode.lenient = true;
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: null }, claimed: [] });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(false);
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it("false when a submission row already exists (with or without photo)", async () => {
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: at(-5) }, submission: { id: "s1" } });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(false);
  });

  it("false for an expired session or link, and an unknown request", async () => {
    expect(await consumeRequest(db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: at(-40) } }).client, REQUEST_ID, NOW)).toBe(false);
    expect(await consumeRequest(db({ request: { id: REQUEST_ID, expires_at: at(-1), used_at: null } }).client, REQUEST_ID, NOW)).toBe(false);
    expect(await consumeRequest(db({ request: null }).client, REQUEST_ID, NOW)).toBe(false);
  });

  it("lenient: still claims when the session.started audit write fails", async () => {
    mode.lenient = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    appendAuditEvent.mockRejectedValue(new Error("down"));
    const d = db({ request: { id: REQUEST_ID, expires_at: at(600), used_at: null } });
    expect(await consumeRequest(d.client, REQUEST_ID, NOW)).toBe(true);
  });
});
