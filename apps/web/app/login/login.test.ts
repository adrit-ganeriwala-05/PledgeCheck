import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockSupabase } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));

const { destinationFor, NO_ACCESS_PATH } = await import("./destination");
const { GET: continueGET } = await import("./continue/route");
const { POST: signOutPOST } = await import("./sign-out/route");
const { getClinician } = await import("@/lib/clinic/auth");

const USER = "11111111-0000-0000-0000-000000000001";
const PRACTICE = "10000000-0000-0000-0000-000000000000";

function signedIn(role: "prescriber" | "staff" | null, userId: string | null = USER) {
  const mock = mockSupabase({
    user: userId ? { id: userId } : null,
    tables: { clinicians: { data: role ? { id: userId, practice_id: PRACTICE, role } : null, error: null } },
  });
  mocks.client = mock.client;
  return mock;
}

async function landing() {
  const res = await continueGET(new Request("http://localhost:3000/login/continue"));
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!).pathname;
}

describe("role routing", () => {
  it("destinationFor maps each result", () => {
    const clinician = (role: "prescriber" | "staff") => ({ ok: true as const, clinician: { id: USER, practiceId: PRACTICE, role } });
    expect(destinationFor(clinician("prescriber"))).toBe("/queue");
    expect(destinationFor(clinician("staff"))).toBe("/patients");
    expect(destinationFor({ ok: false, status: 403, error: "not_a_clinician" })).toBe(NO_ACCESS_PATH);
    expect(destinationFor({ ok: false, status: 401, error: "unauthenticated" })).toBe("/login");
  });

  it("prescriber lands on /queue", async () => {
    signedIn("prescriber");
    expect(await landing()).toBe("/queue");
  });

  it("staff lands on /patients", async () => {
    signedIn("staff");
    expect(await landing()).toBe("/patients");
  });

  it("a user with no clinicians row lands on the no-access screen", async () => {
    signedIn(null);
    expect(await landing()).toBe("/login/no-access");
  });

  it("no session goes back to /login", async () => {
    signedIn(null, null);
    expect(await landing()).toBe("/login");
  });
});

describe("getClinician (reused from lib/clinic/auth)", () => {
  it("is not a clinician without a session", async () => {
    const { client } = signedIn(null, null);
    expect(await getClinician(client as never)).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });
});

describe("POST /login/sign-out", () => {
  beforeEach(() => {
    mocks.client = { auth: { signOut: vi.fn(async () => ({ error: null })) } };
  });

  it("signs out and returns to /login", async () => {
    const res = await signOutPOST(new Request("http://localhost:3000/login/sign-out", { method: "POST" }));
    expect((mocks.client as { auth: { signOut: ReturnType<typeof vi.fn> } }).auth.signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});
