// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueCard } from "@/lib/clinic/queue";
import { makeCard } from "@/test/queue-card-fixture";

import { COLLAPSE_MS, QueueBoard, REFRESH_INTERVAL_MS } from "./queue-board";

type Reply = { status: number; body: unknown } | "network" | Promise<{ status: number; body: unknown }>;

let queueReplies: Reply[];
let reviewReplies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function answer(reply: Reply | undefined) {
  if (reply === undefined) return json(200, { cards: [] });
  if (reply === "network") throw new TypeError("network");
  const r = await reply;
  return json(r.status, r.body);
}

function cards(...list: QueueCard[]) {
  return { status: 200, body: { cards: list } };
}

beforeEach(() => {
  queueReplies = [];
  reviewReplies = [];
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/queue")) return answer(queueReplies.length > 1 ? queueReplies.shift() : queueReplies[0]);
    if (url.startsWith("/api/reviews")) return answer(reviewReplies.shift());
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const queueCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/queue")).length;
const reviewCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/reviews")).length;

describe("QueueBoard states", () => {
  it("shows skeleton cards while loading", async () => {
    let release!: (v: { status: number; body: unknown }) => void;
    queueReplies = [new Promise((r) => (release = r))];
    render(<QueueBoard />);
    expect(screen.getAllByTestId("queue-skeleton")).toHaveLength(3);
    expect(screen.getByText("Loading tests waiting for review")).toBeInTheDocument();
    await act(async () => release(cards()));
  });

  it("shows the empty state", async () => {
    queueReplies = [cards()];
    render(<QueueBoard />);
    expect(await screen.findByText("No tests waiting for review")).toBeInTheDocument();
  });

  it("shows an error with Retry, and Retry reloads", async () => {
    queueReplies = [{ status: 500, body: { error: "queue_failed" } }, cards(makeCard())];
    render(<QueueBoard />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load the queue")).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("PT-1042")).toBeInTheDocument();
  });

  it("asks to sign in on 401", async () => {
    queueReplies = [{ status: 401, body: { error: "unauthenticated" } }];
    render(<QueueBoard />);
    expect(await screen.findByText("Sign in required")).toBeInTheDocument();
  });
});

describe("QueueBoard review flow", () => {
  it("disables both buttons while pending and never double-submits", async () => {
    queueReplies = [cards(makeCard())];
    let release!: (v: { status: number; body: unknown }) => void;
    reviewReplies = [new Promise((r) => (release = r))];
    render(<QueueBoard />);
    const approve = await screen.findByRole("button", { name: "Approve test for PT-1042" });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toBeDisabled());
    expect(screen.getByRole("button", { name: "Reject test for PT-1042" })).toBeDisabled();
    expect(approve).toHaveTextContent("Approving…");
    fireEvent.click(approve);
    expect(reviewCalls()).toBe(1);
    await act(async () => release({ status: 200, body: { status: "approved", window: null } }));
  });

  it("collapses to a confirmation on success, then leaves the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queueReplies = [cards(makeCard())];
    reviewReplies = [{ status: 200, body: { status: "approved", window: { opensAt: "2026-09-26T15:00:00Z", closesAt: "2026-10-03T15:00:00Z" } } }];
    render(<QueueBoard />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve test for PT-1042" }));
    const confirmation = await screen.findByRole("status");
    expect(confirmation).toHaveTextContent(/^Approved · window closes /);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAPSE_MS + 10);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("No tests waiting for review")).toBeInTheDocument();
  });

  it("shows 'Rejected' after a rejection with a reason", async () => {
    queueReplies = [cards(makeCard())];
    reviewReplies = [{ status: 200, body: { status: "rejected", window: null } }];
    render(<QueueBoard />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject test for PT-1042" }));
    const confirm = screen.getByRole("button", { name: "Confirm reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for rejecting (required)"), { target: { value: "Line unclear" } });
    fireEvent.click(confirm);
    expect(await screen.findByRole("status")).toHaveTextContent("Rejected");
    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => u === "/api/reviews")![1].body)).toEqual({
      submissionId: makeCard().submissionId,
      decision: "rejected",
      reason: "Line unclear",
    });
  });

  it("keeps the card reviewable with an inline error when nothing was saved", async () => {
    queueReplies = [cards(makeCard())];
    reviewReplies = [{ status: 503, body: { error: "window_logic_unavailable" } }];
    render(<QueueBoard />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve test for PT-1042" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was saved/);
    expect(screen.getByRole("button", { name: "Approve test for PT-1042" })).toBeEnabled();
  });

  it.each([
    ["audit_failed", "Decision saved, but the audit log entry failed — tell the team."],
    ["photo_delete_failed", "Decision saved, but photo cleanup failed — tell the team."],
  ])("shows a distinct warning when the decision was saved but %s", async (error, text) => {
    queueReplies = [cards(makeCard())];
    reviewReplies = [{ status: 500, body: { error, reviewRecorded: true } }];
    render(<QueueBoard />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve test for PT-1042" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });
});

describe("QueueBoard refresh", () => {
  it("refetches every 20 seconds and on window focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queueReplies = [cards(makeCard())];
    render(<QueueBoard />);
    await screen.findByText("PT-1042");
    expect(queueCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });
    expect(queueCalls()).toBe(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(queueCalls()).toBe(3));
  });

  it("keeps the list when a background refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queueReplies = [cards(makeCard()), "network", "network"];
    render(<QueueBoard />);
    await screen.findByText("PT-1042");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });
    expect(screen.getByText("PT-1042")).toBeInTheDocument();
    expect(screen.getByText(/Couldn.t refresh just now/)).toBeInTheDocument();
  });
});
