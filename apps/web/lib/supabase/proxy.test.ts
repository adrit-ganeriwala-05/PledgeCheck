import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
const createServerClient = vi.fn(() => ({ auth: { getUser } }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const { updateSession } = await import("./proxy");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("updateSession", () => {
  it("passes through without touching Supabase when env is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await updateSession(new NextRequest("http://localhost/queue"));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("refreshes the session when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-value");
    await updateSession(new NextRequest("http://localhost/queue"));
    expect(getUser).toHaveBeenCalledOnce();
  });
});
