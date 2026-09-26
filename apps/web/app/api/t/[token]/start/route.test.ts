import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/fraud/rate-limit";
import { hashToken } from "@/lib/fraud/token";
import { linkFixture, type LinkFixture, REQUEST_ID } from "@/test/link-fixture";

const mocks = vi.hoisted(() => ({ adminClient: null as unknown, appendAuditEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { POST } = await import("./route");

const TOKEN = "s".repeat(43);

function start(token = TOKEN) {
  return POST(new Request(`http://localhost/api/t/${token}/start`, { method: "POST" }), {
    params: Promise.resolve({ token }),
  });
}

function use(fixture: LinkFixture) {
  mocks.adminClient = fixture.client;
  return fixture;
}

function updateCalls(f: LinkFixture) {
  return f.queries.test_requests.filter((calls) => calls.some((c) => c.method === "update"));
}

beforeEach(() => {
  resetRateLimits();
  mocks.appendAuditEvent.mockReset();
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "0".repeat(64) });
});

describe("POST /api/t/:token/start", () => {
  it("first call sets used_at conditionally and writes one audit event", async () => {
    const f = use(linkFixture({}));
    const before = Date.now();
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, state: "active", challengeCode: "K7Q2" });
    const endsIn = Date.parse(body.sessionEndsAt) - before;
    expect(endsIn).toBeGreaterThanOrEqual(40 * 60_000);
    expect(endsIn).toBeLessThan(40 * 60_000 + 5_000);

    const [update] = updateCalls(f);
    expect(update).toContainEqual({ method: "eq", args: ["token_hash", hashToken(TOKEN)] });
    expect(update).toContainEqual({ method: "is", args: ["used_at", null] });

    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith({
      actor: "system",
      action: "session.started",
      refId: REQUEST_ID,
      payload: {},
    });
  });

  it("second call (already active) returns the same deadline and code, no update, no audit", async () => {
    const usedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const f = use(linkFixture({ usedAt }));
    const body = await (await start()).json();
    expect(body).toEqual({
      ok: true,
      state: "active",
      challengeCode: "K7Q2",
      sessionEndsAt: new Date(Date.parse(usedAt) + 40 * 60_000).toISOString(),
    });
    expect(updateCalls(f)).toHaveLength(0);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("lost race (0 rows updated) falls back to the active state without auditing", async () => {
    const otherStart = new Date(Date.now() - 1000).toISOString();
    use(linkFixture({ claimed: [], usedAtAfterUpdate: otherStart }));
    const res = await start();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: "active",
      sessionEndsAt: new Date(Date.parse(otherStart) + 40 * 60_000).toISOString(),
    });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("409 for an expired link", async () => {
    use(linkFixture({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const res = await start();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, state: "link_expired" });
  });

  it("409 for an expired session and for a submitted link", async () => {
    use(linkFixture({ usedAt: new Date(Date.now() - 41 * 60_000).toISOString() }));
    expect(await (await start()).json()).toEqual({ ok: false, state: "session_expired" });
    use(linkFixture({ usedAt: new Date().toISOString(), submitted: true }));
    expect((await start()).status).toBe(409);
  });

  it("404 for an unknown token", async () => {
    use(linkFixture({ request: null }));
    expect((await start()).status).toBe(404);
  });

  it("still starts the session when the audit write fails", async () => {
    use(linkFixture({}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.appendAuditEvent.mockRejectedValue(new Error("down"));
    expect((await start()).status).toBe(200);
  });
});
