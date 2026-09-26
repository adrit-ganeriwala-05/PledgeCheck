import { afterEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createAdminClient } = await import("./admin");

afterEach(() => {
  vi.unstubAllEnvs();
  createClient.mockClear();
});

describe("createAdminClient", () => {
  it("uses the service role key and never persists a session", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value");
    createAdminClient();
    expect(createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "service-role-test-value",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  });

  it("throws a clear error when the service role key is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY is not set/);
    expect(createClient).not.toHaveBeenCalled();
  });
});
