// Minimal chainable Supabase client double for route tests.
// Every query-builder method returns the builder; awaiting it (or calling
// maybeSingle/single) resolves to the result configured for that table.
import { vi } from "vitest";

export type Result = { data: unknown; error: { code?: string; message?: string } | null };

export type MockConfig = {
  user?: { id: string } | null;
  tables?: Record<string, Result | ((calls: QueryCall[]) => Result)>;
  rpc?: Result;
  storage?: {
    remove?: Result;
    createSignedUrls?: Result;
  };
};

export type QueryCall = { method: string; args: unknown[] };

export function mockSupabase(config: MockConfig) {
  const queries: Record<string, QueryCall[][]> = {};

  const from = vi.fn((table: string) => {
    const calls: QueryCall[] = [];
    (queries[table] ??= []).push(calls);
    const resolve = (): Result => {
      const entry = config.tables?.[table] ?? { data: null, error: null };
      return typeof entry === "function" ? entry(calls) : entry;
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "update", "insert", "delete", "is", "not", "returns"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    builder.maybeSingle = async () => resolve();
    builder.single = async () => resolve();
    builder.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  });

  const remove = vi.fn(async () => config.storage?.remove ?? { data: [], error: null });
  const createSignedUrls = vi.fn(async () => config.storage?.createSignedUrls ?? { data: [], error: null });

  return {
    client: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: config.user ?? null },
          error: config.user ? null : { message: "no session" },
        })),
      },
      from,
      rpc: vi.fn(async () => config.rpc ?? { data: null, error: null }),
      storage: { from: vi.fn(() => ({ remove, createSignedUrls })) },
    },
    queries,
    remove,
    createSignedUrls,
  };
}
