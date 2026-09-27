// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PICKUP_ERRORS, WindowList, type WindowRow } from "./window-list";

const HOUR = 60 * 60 * 1000;
let fetchMock: ReturnType<typeof vi.fn>;

function row(id: string, extra: Partial<WindowRow> = {}): WindowRow {
  return {
    id,
    patientId: `p-${id}`,
    pseudonym: `PT-${id}`,
    isFirstRx: false,
    opensAt: new Date(Date.now() - 48 * HOUR).toISOString(),
    closesAt: new Date(Date.now() + 96 * HOUR).toISOString(),
    filledAt: null,
    status: "open",
    ...extra,
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("WindowList", () => {
  it("marks a prescription picked up through the existing fill route", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, daysToFill: 2 }), { status: 200 }));
    render(<WindowList rows={[row("1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark picked up for PT-1" }));
    expect(await screen.findByText("Picked up")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/windows/fill", expect.objectContaining({ method: "POST", body: JSON.stringify({ windowId: "1" }) }));
    expect(screen.queryByText(/Mark filled/)).not.toBeInTheDocument();
  });

  it("shows missed windows as their own status, recorded or derived", () => {
    render(
      <WindowList
        rows={[
          row("recorded", { status: "missed", isFirstRx: true, closesAt: new Date(Date.now() - HOUR).toISOString() }),
          row("derived", { closesAt: new Date(Date.now() - HOUR).toISOString() }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(item).toHaveAttribute("data-status", "missed");
      expect(within(item).getByText("Missed")).toBeInTheDocument();
      expect(within(item).queryByRole("button")).not.toBeInTheDocument();
    }
    expect(within(items[0]).getByText("Repeat test in clinic")).toBeInTheDocument();
    expect(within(items[1]).getByText(/contact the patient/)).toBeInTheDocument();
  });

  it("explains a window that is no longer open", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, reason: "window is no longer open" }), { status: 409 }));
    render(<WindowList rows={[row("1")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark picked up for PT-1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PICKUP_ERRORS.not_open);
  });
});
