// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeCard } from "@/test/queue-card-fixture";

import { QueueCard } from "./queue-card";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ status: "approved", window: null }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function cardElement() {
  return screen.getByRole("group", { name: /PT-1042/ });
}

describe("QueueCard keyboard shortcuts", () => {
  it("A approves the focused card", async () => {
    const onResolved = vi.fn();
    render(<QueueCard card={makeCard()} onResolved={onResolved} />);
    const card = cardElement();
    card.focus();
    fireEvent.keyDown(card, { key: "a" });
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ ok: true, status: "approved", window: null }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).decision).toBe("approved");
  });

  it("R opens the reason box and focuses it without submitting", async () => {
    render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    fireEvent.keyDown(cardElement(), { key: "R" });
    const reason = await screen.findByLabelText("Reason for rejecting (required)");
    await waitFor(() => expect(reason).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores keys typed inside the card's controls and with modifiers", async () => {
    render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    fireEvent.keyDown(cardElement(), { key: "r" });
    const reason = await screen.findByLabelText("Reason for rejecting (required)");
    fireEvent.keyDown(reason, { key: "a" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Approve test for PT-1042" }), { key: "a" });
    fireEvent.keyDown(cardElement(), { key: "a", ctrlKey: true });
    fireEvent.keyDown(cardElement(), { key: "a", metaKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("staff cards have no shortcuts and are not focus stops", () => {
    render(<QueueCard card={makeCard({ canReview: false })} onResolved={vi.fn()} />);
    const card = cardElement();
    expect(card).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(card, { key: "a" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels the action buttons and advertises the shortcuts", () => {
    render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve test for PT-1042" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject test for PT-1042" })).toBeInTheDocument();
    expect(cardElement()).toHaveAttribute("aria-keyshortcuts", "A R");
  });
});
