import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/fraud/rate-limit";
import { hashToken } from "@/lib/fraud/token";
import { linkFixture, type LinkFixture } from "@/test/link-fixture";

const mocks = vi.hoisted(() => ({ adminClient: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));

const { GET } = await import("./route");

const TOKEN = "t".repeat(43);

function get(token = TOKEN, ip = "203.0.113.7") {
  return GET(new Request(`http://localhost/api/t/${token}`, { headers: { "x-forwarded-for": ip } }), {
    params: Promise.resolve({ token }),
  });
}

function use(fixture: LinkFixture) {
  mocks.adminClient = fixture.client;
  return fixture;
}

beforeEach(() => resetRateLimits());

describe("GET /api/t/:token", () => {
  it("404 invalid for an unknown token, with no detail", async () => {
    const f = use(linkFixture({ request: null }));
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      state: "invalid",
      language: null,
      sessionEndsAt: null,
      challengeCode: null,
    });
    // Looked up by hash, never by the plain token.
    expect(f.queries.test_requests[0]).toContainEqual({ method: "eq", args: ["token_hash", hashToken(TOKEN)] });
  });

  it("ready: no code, no ids", async () => {
    use(linkFixture({ language: "es" }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, state: "ready", language: "es", sessionEndsAt: null, challengeCode: null });
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("active: returns the code and deadline", async () => {
    const startedAt = new Date(Date.now() - 5 * 60_000);
    use(linkFixture({ usedAt: startedAt.toISOString() }));
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: true, state: "active", challengeCode: "K7Q2" });
    expect(body.sessionEndsAt).toBe(new Date(startedAt.getTime() + 40 * 60_000).toISOString());
  });

  it("session_expired: no code", async () => {
    use(linkFixture({ usedAt: new Date(Date.now() - 41 * 60_000).toISOString() }));
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: false, state: "session_expired", challengeCode: null });
  });

  it("link_expired: no code", async () => {
    use(linkFixture({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: false, state: "link_expired", challengeCode: null });
  });

  it("submitted: no code", async () => {
    use(linkFixture({ usedAt: new Date(Date.now() - 60_000).toISOString(), submitted: true }));
    const body = await (await get()).json();
    expect(body).toMatchObject({ ok: false, state: "submitted", challengeCode: null });
  });

  it("rate-limits per IP", async () => {
    use(linkFixture({}));
    for (let i = 0; i < 30; i++) expect((await get(TOKEN, "198.51.100.1")).status).toBe(200);
    const limited = await get(TOKEN, "198.51.100.1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await get(TOKEN, "198.51.100.2")).status).toBe(200);
  });
});
