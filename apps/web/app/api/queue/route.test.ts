import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueResponse, SubmissionRow } from "@/lib/clinic/queue";
import { mockSupabase, type QueryCall } from "@/test/supabase-mock";

const mocks = vi.hoisted(() => ({ userClient: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.userClient }));

const { GET } = await import("./route");

const PRACTICE = "10000000-0000-0000-0000-000000000000";

function row(n: number, status: string, capturedAt: string | null, extra: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: `13000000-0000-0000-0000-00000000000${n}`,
    status,
    captured_at: capturedAt,
    photo_path: `${PRACTICE}/13000000-0000-0000-0000-00000000000${n}.jpg`,
    grok_result: "negative",
    grok_code: "K7Q2",
    grok_confidence: 0.94,
    cv_result: "negative",
    cv_confidence: 0.5,
    flags: [],
    test_requests: {
      challenge_code: "K7Q2",
      patient_id: `11000000-0000-0000-0000-00000000000${n}`,
      patients: { pseudonym: `PT-10${n}0`, phase: "during", language: "en" },
    },
    ...extra,
  };
}

function setup(opts: { user?: boolean; role?: "prescriber" | "staff" | null; rows?: SubmissionRow[]; signed?: unknown[] } = {}) {
  const rows = opts.rows ?? [];
  const mock = mockSupabase({
    user: opts.user === false ? null : { id: "11111111-0000-0000-0000-000000000001" },
    tables: {
      clinicians: {
        data: opts.role === null ? null : { id: "u", practice_id: PRACTICE, role: opts.role ?? "prescriber" },
        error: null,
      },
      // Honor the route's status filter like PostgREST would.
      submissions: (calls: QueryCall[]) => {
        const filter = calls.find((c) => c.method === "in")?.args[1] as string[] | undefined;
        return { data: rows.filter((r) => !filter || filter.includes(r.status)), error: null };
      },
      windows: {
        data: [
          { patient_id: "11000000-0000-0000-0000-000000000002", opens_at: "2026-09-25T10:00:00Z", closes_at: "2026-10-02T10:00:00Z", is_first_rx: true },
        ],
        error: null,
      },
    },
    storage: {
      createSignedUrls: {
        data:
          opts.signed ??
          rows.filter((r) => r.photo_path).map((r) => ({ path: r.photo_path, signedUrl: `https://signed.example/${r.id}`, error: null })),
        error: null,
      },
    },
  });
  mocks.userClient = mock.client;
  return mock;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/queue", () => {
  it("401 without a session", async () => {
    setup({ user: false });
    expect((await GET()).status).toBe(401);
  });

  it("403 for a user with no clinicians row", async () => {
    setup({ role: null });
    expect((await GET()).status).toBe(403);
  });

  it("asks only for the two reviewable statuses and never returns others", async () => {
    const mock = setup({
      rows: [
        row(1, "ready_for_review", "2026-09-26T10:00:00Z"),
        row(2, "rejected_fraud", "2026-09-26T09:00:00Z"),
        row(3, "approved", "2026-09-26T08:00:00Z"),
        row(4, "needs_review", "2026-09-26T11:00:00Z"),
        row(5, "awaiting_photo", null),
      ],
    });
    const body = (await (await GET()).json()) as QueueResponse;
    const statusFilter = mock.queries.submissions[0].find((c) => c.method === "in");
    expect(statusFilter?.args).toEqual(["status", ["ready_for_review", "needs_review"]]);
    expect(body.cards.map((c) => c.status).sort()).toEqual(["needs_review", "ready_for_review"]);
  });

  it("sorts needs_review first, then oldest capture first", async () => {
    setup({
      rows: [
        row(1, "ready_for_review", "2026-09-26T08:00:00Z"),
        row(2, "needs_review", "2026-09-26T12:00:00Z"),
        row(3, "ready_for_review", "2026-09-26T07:00:00Z"),
        row(4, "needs_review", "2026-09-26T09:00:00Z"),
      ],
    });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards.map((c) => c.submissionId.slice(-1))).toEqual(["4", "2", "3", "1"]);
  });

  it("builds the full card shape", async () => {
    setup({ rows: [row(2, "needs_review", "2026-09-26T10:00:00Z", { cv_result: "positive", flags: ["readers_disagree"] })] });
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [card] = ((await res.json()) as QueueResponse).cards;
    expect(card).toEqual({
      submissionId: "13000000-0000-0000-0000-000000000002",
      status: "needs_review",
      capturedAt: "2026-09-26T10:00:00Z",
      patient: { pseudonym: "PT-1020", phase: "during", language: "en" },
      photoUrl: "https://signed.example/13000000-0000-0000-0000-000000000002",
      grok: { result: "negative", code: "K7Q2", confidence: 0.94, codeMatches: true },
      opencv: { result: "positive", confidence: 0.5 },
      readersAgree: false,
      flags: ["readers_disagree"],
      window: { opensAt: "2026-09-25T10:00:00Z", closesAt: "2026-10-02T10:00:00Z", isFirstRx: true },
      canReview: true,
    });
  });

  it("readersAgree is true only when both reads match", async () => {
    setup({
      rows: [
        row(1, "ready_for_review", "2026-09-26T07:00:00Z"),
        row(2, "ready_for_review", "2026-09-26T08:00:00Z", { cv_result: "invalid" }),
        row(3, "ready_for_review", "2026-09-26T09:00:00Z", { grok_result: null, cv_result: null }),
      ],
    });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards.map((c) => c.readersAgree)).toEqual([true, false, false]);
  });

  it("photoUrl is null when photo_path is missing or the object does not exist", async () => {
    const rows = [row(1, "ready_for_review", "2026-09-26T07:00:00Z", { photo_path: null }), row(2, "ready_for_review", "2026-09-26T08:00:00Z")];
    setup({ rows, signed: [{ path: rows[1].photo_path, signedUrl: null, error: "Object not found" }] });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards.map((c) => c.photoUrl)).toEqual([null, null]);
  });

  it("requests 5-minute signed URLs", async () => {
    const mock = setup({ rows: [row(1, "ready_for_review", "2026-09-26T07:00:00Z")] });
    await GET();
    expect(mock.createSignedUrls).toHaveBeenCalledWith([row(1, "x", null).photo_path], 300);
  });

  it("canReview is false for staff", async () => {
    setup({ role: "staff", rows: [row(1, "ready_for_review", "2026-09-26T07:00:00Z")] });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards[0].canReview).toBe(false);
  });

  it("codeMatches is false for a wrong code and null when no code was read", async () => {
    setup({
      rows: [
        row(1, "needs_review", "2026-09-26T07:00:00Z", { grok_code: "X0X0" }),
        row(2, "needs_review", "2026-09-26T08:00:00Z", { grok_code: null }),
      ],
    });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards.map((c) => c.grok.codeMatches)).toEqual([false, null]);
  });

  it("codeMatches ignores case and every space, like the fraud check", async () => {
    setup({
      rows: [
        row(1, "needs_review", "2026-09-26T07:00:00Z", { grok_code: "K7 Q2" }),
        row(2, "needs_review", "2026-09-26T08:00:00Z", { grok_code: " k7q2 " }),
        row(3, "needs_review", "2026-09-26T09:00:00Z", { grok_code: "K7 Q3" }),
      ],
    });
    const body = (await (await GET()).json()) as QueueResponse;
    expect(body.cards.map((c) => c.grok.codeMatches)).toEqual([true, true, false]);
  });

  it("returns an empty list when nothing is waiting", async () => {
    setup({ rows: [] });
    expect(await (await GET()).json()).toEqual({ cards: [] });
  });
});
