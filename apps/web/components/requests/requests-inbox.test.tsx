// @vitest-environment jsdom
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RefillRequest } from "@/lib/api/contracts";

configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({
  listRefillRequests: vi.fn(),
  approveRefillRequest: vi.fn(),
  declineRefillRequest: vi.fn(),
  resendTestLink: vi.fn(),
}));
vi.mock("@/lib/api/client", () => mocks);

const { describeAge, RequestsInbox } = await import("./requests-inbox");

function req(id: string, pseudonym: string, extra: Partial<RefillRequest> = {}): RefillRequest {
  return {
    id,
    patientId: `p-${id}`,
    pseudonym,
    status: "requested",
    requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    emailStatus: null,
    declineReason: null,
    ...extra,
  };
}

let pending: RefillRequest[];
let failed: RefillRequest[];

beforeEach(() => {
  vi.clearAllMocks();
  pending = [req("r1", "PT-1042"), req("r2", "PT-2231")];
  failed = [];
  mocks.listRefillRequests.mockImplementation(async ({ status }: { status: string }) => ({
    ok: true,
    data: status === "requested" ? pending : failed,
  }));
});

describe("describeAge", () => {
  it("formats minutes, hours and days", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(describeAge("2026-09-27T11:59:30Z", now)).toBe("just now");
    expect(describeAge("2026-09-27T11:15:00Z", now)).toBe("45m ago");
    expect(describeAge("2026-09-27T07:00:00Z", now)).toBe("5h ago");
    expect(describeAge("2026-09-25T09:00:00Z", now)).toBe("2d 3h ago");
  });
});

describe("RequestsInbox", () => {
  it("lists pending requests with pseudonym and age, then the empty state", async () => {
    render(<RequestsInbox />);
    expect(await screen.findByText("PT-1042")).toBeInTheDocument();
    expect(screen.getAllByText("2h ago")).toHaveLength(2);
    expect(mocks.listRefillRequests).toHaveBeenCalledWith({ status: "requested" });
    expect(mocks.listRefillRequests).toHaveBeenCalledWith({ status: "approved", emailStatus: "failed" });
  });

  it("shows the empty state", async () => {
    pending = [];
    render(<RequestsInbox />);
    expect(await screen.findByText("No requests waiting")).toBeInTheDocument();
  });

  it("approve → email sent badge", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: true, data: { emailStatus: "sent" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    const handled = await screen.findByRole("heading", { name: "Handled just now" });
    const section = handled.closest("section")!;
    expect(within(section).getByText("PT-1042")).toBeInTheDocument();
    expect(section.querySelector('[data-email-status="sent"]')).toHaveTextContent("Email sent");
  });

  it("approve → email disabled explains the fallback", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: true, data: { emailStatus: "disabled" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    expect(await screen.findByText("Email off")).toBeInTheDocument();
    expect(screen.getByText(/can start from their portal/)).toBeInTheDocument();
  });

  it("approve → email failed stays visible with Resend, and resending clears it", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: true, data: { emailStatus: "failed" } });
    mocks.resendTestLink.mockResolvedValue({ ok: true, data: { emailStatus: "sent" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    const resend = await screen.findByRole("button", { name: "Resend link to PT-1042" });
    expect(screen.getByText("Email failed")).toBeInTheDocument();
    fireEvent.click(resend);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resend link to PT-1042" })).not.toBeInTheDocument());
    expect(mocks.resendTestLink).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Link resent")).toBeInTheDocument();
  });

  it("lists failed emails from the server with Resend, and keeps them if resending fails again", async () => {
    failed = [req("r9", "PT-6604", { status: "approved", emailStatus: "failed" })];
    mocks.resendTestLink.mockResolvedValue({ ok: true, data: { emailStatus: "failed" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Resend link to PT-6604" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still didn't send");
    expect(screen.getByRole("button", { name: "Resend link to PT-6604" })).toBeInTheDocument();
  });

  it("409 not_pending: says someone else handled it and refreshes", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: false, error: { code: "not_pending", status: 409 } });
    render(<RequestsInbox />);
    await screen.findByText("PT-1042");
    pending = [req("r2", "PT-2231")];
    fireEvent.click(screen.getByRole("button", { name: "Approve refill request for PT-1042" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("already handled by someone else");
    await waitFor(() => expect(screen.queryByText("PT-1042")).not.toBeInTheDocument());
  });

  it("decline requires a reason", async () => {
    mocks.declineRefillRequest.mockResolvedValue({ ok: true, data: { ok: true } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline refill request for PT-2231" }));
    const confirm = screen.getByRole("button", { name: "Confirm decline" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for declining/), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for declining/), { target: { value: "Please book a visit." } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.declineRefillRequest).toHaveBeenCalledWith("r2", "Please book a visit."));
    expect(await screen.findByText("Declined")).toBeInTheDocument();
  });

  it("shows a row error on a network failure and keeps the request", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: false, error: { code: "network_error", status: 0 } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(screen.getByText("PT-1042")).toBeInTheDocument();
  });

  it.each([
    ["unauthenticated", "Sign in required"],
    ["not_a_clinician", "No clinic access"],
    ["not_available", "Refill requests aren't available yet"],
    ["server_error", "Could not load refill requests"],
  ])("load error %s", async (code, text) => {
    mocks.listRefillRequests.mockResolvedValue({ ok: false, error: { code, status: 500 } });
    render(<RequestsInbox />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("shows a loading state first", () => {
    mocks.listRefillRequests.mockReturnValue(new Promise(() => {}));
    render(<RequestsInbox />);
    expect(screen.getAllByTestId("requests-skeleton")).toHaveLength(3);
  });
});
