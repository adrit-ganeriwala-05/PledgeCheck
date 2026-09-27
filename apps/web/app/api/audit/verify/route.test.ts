import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  verifyAudit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/audit/verify", () => ({ verifyAudit: mocks.verifyAudit }));

const { GET } = await import("./route");

const STAFF = "11111111-0000-0000-0000-000000000002";
const PRACTICE = "10000000-0000-0000-0000-000000000000";

function signIn(opts: { user?: boolean; clinician?: boolean } = {}) {
  mocks.userClient = mockSupabase({
    user: opts.user === false ? null : { id: STAFF },
    tables: {
      clinicians: { data: opts.clinician === false ? null : { id: STAFF, practice_id: PRACTICE, role: "staff" }, error: null },
    },
  }).client;
}

beforeEach(() => {
  mocks.verifyAudit.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/audit/verify", () => {
  it("401 without a session and 403 without a clinician row", async () => {
    signIn({ user: false });
    expect((await GET()).status).toBe(401);
    signIn({ clinician: false });
    expect((await GET()).status).toBe(403);
    expect(mocks.verifyAudit).not.toHaveBeenCalled();
  });

  it("200 with the verification result, read through the clinician's own client", async () => {
    signIn();
    const result = { ok: true, status: "intact", headSeq: 20 };
    mocks.verifyAudit.mockResolvedValue(result);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(mocks.verifyAudit).toHaveBeenCalledWith(mocks.userClient);
  });

  it("500 verify_failed when the database read fails", async () => {
    signIn();
    mocks.verifyAudit.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "verify_failed" });
  });
});
