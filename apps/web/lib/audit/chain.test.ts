import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const { appendToChain } = vi.hoisted(() => ({ appendToChain: vi.fn() }));
vi.mock("./append", () => ({ appendAuditEvent: appendToChain }));

const { appendAuditEvent } = await import("./chain");

const db = {} as SupabaseClient;
const input = {
  actor: "patient",
  action: "submission.rejected_link",
  refId: null,
  payload: { failure: "expired" },
};

afterEach(() => {
  appendToChain.mockReset();
  vi.restoreAllMocks();
});

describe("chain.ts compatibility shim", () => {
  it("delegates to the single audit writer and returns its result", async () => {
    appendToChain.mockResolvedValue({ seq: 3, hash: "c".repeat(64) });
    await expect(appendAuditEvent(db, input, new Date())).resolves.toEqual({ seq: 3, hash: "c".repeat(64) });
    expect(appendToChain).toHaveBeenCalledWith(input);
  });

  it("is best effort: logs and returns null on failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    appendToChain.mockRejectedValue(new Error("unknown audit action"));
    await expect(appendAuditEvent(db, input, new Date())).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith("[audit] append failed", {
      action: "submission.rejected_link",
      cause: "unknown audit action",
    });
  });
});
