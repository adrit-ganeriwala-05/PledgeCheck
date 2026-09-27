import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  anchorNow: vi.fn(),
  configured: true,
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./anchor", () => ({ anchorNow: mocks.anchorNow }));
vi.mock("./solana", () => ({ isSolanaConfigured: () => mocks.configured }));

const { scheduleAutoAnchor, resetAutoAnchorWarning } = await import("./auto-anchor");

const RESULT = { signature: "5".repeat(88), explorerUrl: "x", headSeq: 20, headHash: "a".repeat(64), reused: false }; // test vector

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.after.mockReset();
  mocks.anchorNow.mockReset();
  mocks.anchorNow.mockResolvedValue(RESULT);
  mocks.configured = true;
  resetAutoAnchorWarning();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("scheduleAutoAnchor", () => {
  it("skips silently with one warning per process when Solana is not configured", async () => {
    mocks.configured = false;
    await scheduleAutoAnchor();
    await scheduleAutoAnchor();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/^\[auto-anchor\]/);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.anchorNow).not.toHaveBeenCalled();
  });

  it("defers the anchor to after() inside a request", async () => {
    await scheduleAutoAnchor();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.anchorNow).not.toHaveBeenCalled();

    const task = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await task();
    expect(mocks.anchorNow).toHaveBeenCalledOnce();
  });

  it("swallows and logs a failure inside the deferred task", async () => {
    mocks.anchorNow.mockRejectedValue(Object.assign(new Error("confirmed but not recorded"), { name: "AnchorRecordError", signature: "sig" }));
    await scheduleAutoAnchor();
    const task = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(task()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[auto-anchor\]/),
      expect.objectContaining({ error: "AnchorRecordError", signature: "sig" }),
    );
  });

  it("awaits the anchor directly when after() is unavailable", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });
    await scheduleAutoAnchor();
    expect(mocks.anchorNow).toHaveBeenCalledOnce();
  });

  it("never throws when the direct anchor fails", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("outside a request scope");
    });
    mocks.anchorNow.mockRejectedValue(new Error("rpc down"));
    await expect(scheduleAutoAnchor()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[auto-anchor\]/), expect.anything());
  });

  it("caps the direct wait at 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      mocks.after.mockImplementation(() => {
        throw new Error("outside a request scope");
      });
      mocks.anchorNow.mockReturnValue(new Promise(() => {}));
      let done = false;
      const pending = scheduleAutoAnchor().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
