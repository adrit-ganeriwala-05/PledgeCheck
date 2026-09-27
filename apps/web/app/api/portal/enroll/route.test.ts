import { beforeEach, describe, expect, it, vi } from "vitest";

import { homeRefusal } from "@/lib/fraud/home-guards";
import { mockSupabase, type QueryCall, type Result } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({
  userClient: null as unknown,
  adminClient: null as unknown,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.adminClient }));
vi.mock("@/lib/audit/append", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

const { POST } = await import("./route");

const USER = "a38d3c6b-850f-427e-8974-f50d576f478d";
const EMAIL = "someone@example.test";
const PRACTICE = "10000000-0000-0000-0000-000000000000";
const NEW_PATIENT = "11000000-0000-0000-0000-00000000aaaa";

function req(payload: unknown) {
  return new Request("http://localhost/api/portal/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function setup(opts: {
  user?: string | null;
  existingPatient?: Record<string, unknown> | null;
  practice?: Record<string, unknown> | null;
  insert?: Result;
} = {}) {
  const user = opts.user === undefined ? USER : opts.user;
  mocks.userClient = mockSupabase({ user: user ? { id: user } : null }).client;
  // getUser() in the route reads .email, which the shared mock does not model.
  (mocks.userClient as { auth: { getUser: () => Promise<unknown> } }).auth.getUser = async () => ({
    data: { user: user ? { id: user, email: EMAIL } : null },
    error: user ? null : { message: "no session" },
  });

  const admin = mockSupabase({
    tables: {
      patients: (calls: QueryCall[]) => {
        const isInsert = calls.some((c) => c.method === "insert");
        if (isInsert) return opts.insert ?? { data: { id: NEW_PATIENT, pseudonym: "PT-4242" }, error: null };
        return { data: opts.existingPatient ?? null, error: null };
      },
      practices: { data: opts.practice === undefined ? { id: PRACTICE } : opts.practice, error: null },
    },
  });
  mocks.adminClient = admin.client;
  return admin;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.appendAuditEvent.mockResolvedValue({ seq: 1, hash: "x" });
});

describe("POST /api/portal/enroll", () => {
  it("400 without a valid practice id", async () => {
    setup();
    expect((await POST(req({ practiceId: "nope" }))).status).toBe(400);
  });

  it("401 without a session", async () => {
    setup({ user: null });
    expect((await POST(req({ practiceId: PRACTICE }))).status).toBe(401);
  });

  it("404 for a practice that does not exist", async () => {
    setup({ practice: null });
    expect((await POST(req({ practiceId: PRACTICE }))).status).toBe(404);
  });

  it("409 rather than creating a second record for the same login", async () => {
    setup({ existingPatient: { id: "already" } });
    const res = await POST(req({ practiceId: PRACTICE }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_enrolled" });
  });

  it("creates the record with home testing on and able to take effect", async () => {
    const admin = setup();
    const res = await POST(req({ practiceId: PRACTICE }));
    expect(res.status).toBe(201);

    const insert = admin.queries.patients.flat().find((c) => c.method === "insert");
    const row = insert?.args[0] as Record<string, unknown>;

    // The flag alone does nothing while phase is 'pre': homeRefusal() and the rules engine
    // both refuse a pre-treatment home test. A started course is what lets it work.
    expect(row.home_testing_allowed).toBe(true);
    expect(row.phase).toBe("during");
    expect(row.treatment_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(homeRefusal(row as Parameters<typeof homeRefusal>[0])).toBeNull();
    expect(row.can_get_pregnant).toBe(true);

    expect(row.practice_id).toBe(PRACTICE);
    expect(row.auth_user_id).toBe(USER);
  });

  it("takes the login from the session, never from the body", async () => {
    const admin = setup();
    await POST(req({ practiceId: PRACTICE, auth_user_id: "someone-else", phase: "complete" }));
    const insert = admin.queries.patients.flat().find((c) => c.method === "insert");
    const row = insert?.args[0] as Record<string, unknown>;
    expect(row.auth_user_id).toBe(USER);
    expect(row.phase).toBe("during");
  });

  it("puts no real name in the schema, only a generated pseudonym", async () => {
    const admin = setup();
    await POST(req({ practiceId: PRACTICE }));
    const insert = admin.queries.patients.flat().find((c) => c.method === "insert");
    const row = insert?.args[0] as Record<string, unknown>;
    expect(String(row.pseudonym)).toMatch(/^PT-\d{4}$/);
  });

  it("keeps the record when the audit write fails", async () => {
    setup();
    mocks.appendAuditEvent.mockRejectedValue(new Error("audit down"));
    expect((await POST(req({ practiceId: PRACTICE }))).status).toBe(201);
  });

  it("500 and no audit when the insert fails", async () => {
    setup({ insert: { data: null, error: { message: "denied" } } });
    expect((await POST(req({ practiceId: PRACTICE }))).status).toBe(500);
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
