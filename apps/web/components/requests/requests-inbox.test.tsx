// @vitest-environment jsdom
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RefillRequest } from "@/lib/api/contracts";

configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({
  listRefillRequests: vi.fn(),
  approveRefillRequest: vi.fn(),
  declineRefillRequest: vi.fn(),
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
    hasEmail: true,
    declineReason: null,
    ...extra,
  };
}

let pending: RefillRequest[];

beforeEach(() => {
  vi.clearAllMocks();
  pending = [req("r1", "PT-1042"), req("r2", "PT-2231")];
  mocks.listRefillRequests.mockImplementation(async () => ({ ok: true, data: pending }));
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
    expect(screen.getByText(/no address on file/)).toBeInTheDocument();
  });

  it("warns before approving when the patient has no address", async () => {
    pending = [req("r1", "PT-1042", { hasEmail: false })];
    render(<RequestsInbox />);
    expect(await screen.findByText(/no email on file/)).toBeInTheDocument();
  });

  it("passes hasEmail to the approver, so a missing address is not read as a failure", async () => {
    pending = [req("r1", "PT-1042", { hasEmail: false })];
    mocks.approveRefillRequest.mockResolvedValue({ ok: true, data: { emailStatus: "disabled" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    await waitFor(() => expect(mocks.approveRefillRequest).toHaveBeenCalledWith("r1", false));
  });

  it("approve → a failed email is reported on the handled card", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: true, data: { emailStatus: "failed" } });
    render(<RequestsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve refill request for PT-1042" }));
    const handled = await screen.findByRole("heading", { name: "Handled just now" });
    const section = handled.closest("section")!;
    expect(section.querySelector('[data-email-status="failed"]')).toHaveTextContent("Email failed");
    // The link was still issued, so the card says how to get it to the patient.
    expect(within(section).getByText(/pass it to the patient another way/)).toBeInTheDocument();
  });

  it("409 already_decided: says someone else handled it and refreshes", async () => {
    mocks.approveRefillRequest.mockResolvedValue({ ok: false, error: { code: "already_decided", status: 409 } });
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
