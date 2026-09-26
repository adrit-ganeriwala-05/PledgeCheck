import { afterEach, describe, expect, it, vi } from "vitest";

import { MissingEnvError, publicEnv, serverEnv } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverEnv", () => {
  it("does not validate at import time", () => {
    vi.stubEnv("XAI_API_KEY", "");
    expect(() => Object.keys(serverEnv)).not.toThrow();
  });

  it("throws a clear error naming the variable when it is missing", () => {
    vi.stubEnv("TIGER_DATABASE_URL", "");
    expect(() => serverEnv.TIGER_DATABASE_URL).toThrow(MissingEnvError);
    expect(() => serverEnv.TIGER_DATABASE_URL).toThrow(/TIGER_DATABASE_URL is not set/);
  });

  it("rejects an invalid value without echoing it", () => {
    vi.stubEnv("ANALYZE_URL", "not a url");
    expect(() => serverEnv.ANALYZE_URL).toThrow(/ANALYZE_URL is invalid/);
    try {
      void serverEnv.ANALYZE_URL;
    } catch (err) {
      expect((err as Error).message).not.toContain("not a url");
    }
  });

  it("requires ANALYZE_SERVICE_KEY to be at least 32 characters", () => {
    vi.stubEnv("ANALYZE_SERVICE_KEY", "short");
    expect(() => serverEnv.ANALYZE_SERVICE_KEY).toThrow(/is invalid/);
    vi.stubEnv("ANALYZE_SERVICE_KEY", "a".repeat(64));
    expect(serverEnv.ANALYZE_SERVICE_KEY).toBe("a".repeat(64));
  });

  it("returns a valid value", () => {
    vi.stubEnv("ANALYZE_URL", "https://api.pledgecheck.tech");
    expect(serverEnv.ANALYZE_URL).toBe("https://api.pledgecheck.tech");
  });
});

describe("publicEnv", () => {
  it("exposes only the two NEXT_PUBLIC_* values", () => {
    expect(Object.keys(Object.getOwnPropertyDescriptors(publicEnv)).sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("validates the Supabase URL lazily", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(() => publicEnv.NEXT_PUBLIC_SUPABASE_URL).toThrow(/is not set/);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(publicEnv.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
  });
});
