// Admin-client double for the public link routes: one test_requests row (or none),
// the patient's language, whether a photo submission exists, and the result of the
// conditional used_at update.
import { mockSupabase, type QueryCall } from "./supabase-mock";

export type LinkFixtureOptions = {
  request?: null;
  usedAt?: string | null;
  expiresAt?: string;
  submitted?: boolean;
  language?: "en" | "es";
  /** Rows returned by the conditional update; defaults to one (the start won). */
  claimed?: { id: string }[];
  /** used_at seen by lookups after the update, e.g. to simulate losing a race. */
  usedAtAfterUpdate?: string | null;
};

export const REQUEST_ID = "12000000-0000-0000-0000-000000000001";
export const PATIENT_ID = "11000000-0000-0000-0000-000000000001";

export function linkFixture(opts: LinkFixtureOptions) {
  let updated = false;
  const row = () => ({
    id: REQUEST_ID,
    patient_id: PATIENT_ID,
    challenge_code: "K7Q2",
    setting: "home",
    expires_at: opts.expiresAt ?? new Date(Date.now() + 12 * 3600_000).toISOString(),
    used_at: updated && opts.usedAtAfterUpdate !== undefined ? opts.usedAtAfterUpdate : (opts.usedAt ?? null),
  });

  const mock = mockSupabase({
    tables: {
      test_requests: (calls: QueryCall[]) => {
        if (calls.some((c) => c.method === "update")) {
          updated = true;
          return { data: opts.claimed ?? [{ id: REQUEST_ID }], error: null };
        }
        return { data: opts.request === null ? null : row(), error: null };
      },
      patients: { data: { language: opts.language ?? "en" }, error: null },
      submissions: { data: opts.submitted ? { id: "13000000-0000-0000-0000-000000000001" } : null, error: null },
    },
  });
  return { client: mock.client, queries: mock.queries };
}

export type LinkFixture = ReturnType<typeof linkFixture>;
