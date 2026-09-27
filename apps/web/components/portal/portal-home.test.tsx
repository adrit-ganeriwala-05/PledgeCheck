// @vitest-environment jsdom
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Cycle, CycleStatus } from "@/lib/api/contracts";

configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  getPatientCycle: vi.fn(),
  requestRefill: vi.fn(),
  patientSignOut: vi.fn(async () => ({ ok: true, data: null })),
  enrollPatient: vi.fn(),
  listClinics: vi.fn(async () => ({ ok: true, data: { clinics: [{ id: "pr1", name: "Peachtree Dermatology", prescribers: ["Dr. Rivera"] }] } })),
  assign: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, push: vi.fn() }) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  getPatientCycle: mocks.getPatientCycle,
  requestRefill: mocks.requestRefill,
  patientSignOut: mocks.patientSignOut,
  enrollPatient: mocks.enrollPatient,
  listClinics: mocks.listClinics,
}));

const { PortalHome, LOGIN_PATH, REQUEST_BLOCKED_NOTE } = await import("./portal-home");

function cycle(status: CycleStatus, extra: Partial<Cycle> = {}): Cycle {
  return {
    id: "c1",
    status,
    timestamps: { requested: "2026-09-27T10:00:00Z" },
    emailStatus: null,
    pickupDeadline: null,
    declineReason: null,
    rejectReason: null,
    canRequestAgain: false,
    ...extra,
  };
}

function withCycle(c: Cycle | null) {
  mocks.getPatientCycle.mockResolvedValue({ ok: true, data: { cycle: c } });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "location", { value: { ...window.location, assign: mocks.assign }, configurable: true });
});

const DAY = 24 * 60 * 60 * 1000;

describe("PortalHome cycle states", () => {
  it.each([
    ["no open cycle", null, "Ready for this month's check", "Request refill"],
    ["requested", cycle("requested"), "Waiting for your clinic", null],
    ["declined", cycle("declined", { declineReason: "Please see us first.", canRequestAgain: true }), "Your clinic declined this request", "Request again"],
    ["approved, email sent", cycle("approved", { emailStatus: "sent" }), "Check your email for your test link", null],
    ["approved, email failed", cycle("approved", { emailStatus: "failed" }), "Your clinic is resending your link", null],
    ["submitted", cycle("submitted"), "Submitted, your clinic will review it", null],
    ["in review", cycle("in_review"), "Submitted, your clinic will review it", null],
    ["rejected", cycle("rejected", { rejectReason: "Blurry photo." }), "Your clinic asked for a new test", null],
    ["expired", cycle("expired", { canRequestAgain: true }), "This request expired", "Request again"],
    ["window open", cycle("window_open", { pickupDeadline: new Date(Date.now() + 3 * DAY).toISOString() }), "Your prescription is ready for pickup", null],
    ["picked up", cycle("picked_up"), "This month is complete", "Request refill"],
    ["missed", cycle("missed", { pickupDeadline: new Date(Date.now() - DAY).toISOString() }), "Your pickup window closed", null],
  ] as const)("%s", async (_name, c, title, action) => {
    withCycle(c);
    const { container } = render(<PortalHome />);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    if (action) expect(screen.getByRole("button", { name: action })).toBeEnabled();
    // Nothing on any portal state reveals a reading, a flag or a fraud check.
    expect(container.textContent).not.toMatch(/\b(positive|negative|confidence|grok|opencv|fraud|reuse|mismatch)\b/i);
    expect(container.textContent).not.toMatch(/challenge code/i);
  });

  it("shows the clinic's reason on a declined or rejected cycle", async () => {
    withCycle(cycle("declined", { declineReason: "Please book a visit first.", canRequestAgain: true }));
    render(<PortalHome />);
    expect(await screen.findByText("Please book a visit first.")).toBeInTheDocument();
    expect(screen.getByText("From your clinic")).toBeInTheDocument();
  });

  it("shows a live pickup countdown while the window is open", async () => {
    withCycle(cycle("window_open", { pickupDeadline: new Date(Date.now() + 2 * DAY + 3 * 60 * 60 * 1000).toISOString() }));
    render(<PortalHome />);
    expect(await screen.findByRole("timer")).toHaveTextContent(/2 days, (2|3) hours left/);
  });

  it("disables Request refill with an explanation while a request is still pending", async () => {
    withCycle(cycle("requested"));
    render(<PortalHome />);
    const button = await screen.findByRole("button", { name: "Request refill" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(REQUEST_BLOCKED_NOTE);
  });
});

describe("PortalHome actions", () => {
  it("requests a refill and reloads the cycle", async () => {
    mocks.getPatientCycle
      .mockResolvedValueOnce({ ok: true, data: { cycle: null } })
      .mockResolvedValue({ ok: true, data: { cycle: cycle("requested") } });
    mocks.requestRefill.mockResolvedValue({ ok: true, data: { requestId: "r1", createdAt: "2026-09-27T10:00:00Z" } });
    render(<PortalHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Request refill" }));
    expect(await screen.findByRole("heading", { name: "Waiting for your clinic" })).toBeInTheDocument();
  });

  it("explains already_pending", async () => {
    mocks.getPatientCycle
      .mockResolvedValueOnce({ ok: true, data: { cycle: null } })
      .mockResolvedValue({ ok: true, data: { cycle: cycle("requested") } });
    mocks.requestRefill.mockResolvedValue({ ok: false, error: { code: "already_pending", status: 409 } });
    render(<PortalHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Request refill" }));
    expect(await screen.findByText(/already have an open request/)).toBeInTheDocument();
  });

  it("offers no way to start a test: the emailed link is the only route", async () => {
    withCycle(cycle("approved", { emailStatus: "sent" }));
    const { container } = render(<PortalHome />);
    await screen.findByRole("heading", { name: "Check your email for your test link" });
    expect(screen.queryByRole("button", { name: /start your test/i })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\/t\//);
  });
});

describe("PortalHome access states", () => {
  it("sends a signed-out patient to sign in, returning to the portal", async () => {
    mocks.getPatientCycle.mockResolvedValue({ ok: false, error: { code: "unauthenticated", status: 401 } });
    render(<PortalHome />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(LOGIN_PATH));
    expect(LOGIN_PATH).toBe("/portal/login?next=%2Fportal");
  });

  it("asks a signed-in, unlinked account to pick its clinic", async () => {
    mocks.getPatientCycle
      .mockResolvedValueOnce({ ok: false, error: { code: "not_enrolled", status: 403 } })
      .mockResolvedValue({ ok: true, data: { cycle: null } });
    mocks.enrollPatient.mockResolvedValue({ ok: true, data: { patientId: "p1", pseudonym: "PT-9001" } });
    render(<PortalHome />);
    expect(await screen.findByRole("heading", { name: "Link your account to your clinic" })).toBeInTheDocument();
    const select = await screen.findByLabelText("Your clinic");
    await waitFor(() => expect(screen.getByRole("option", { name: /Peachtree Dermatology/ })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "pr1" } });
    fireEvent.click(screen.getByRole("button", { name: "Link my account" }));
    await waitFor(() => expect(mocks.enrollPatient).toHaveBeenCalledWith("pr1"));
    expect(await screen.findByRole("heading", { name: "Ready for this month's check" })).toBeInTheDocument();
  });

  it("shows an error with retry, and a clear message when the portal isn't built yet", async () => {
    mocks.getPatientCycle
      .mockResolvedValueOnce({ ok: false, error: { code: "not_available", status: 404 } })
      .mockResolvedValue({ ok: true, data: { cycle: null } });
    render(<PortalHome />);
    expect(await screen.findByRole("heading", { name: "Your portal isn't available yet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Ready for this month's check" })).toBeInTheDocument();
  });

  it("shows a loading state first", () => {
    mocks.getPatientCycle.mockReturnValue(new Promise(() => {}));
    render(<PortalHome />);
    expect(screen.getByText("Loading your portal")).toBeInTheDocument();
  });

  it("signs out", async () => {
    withCycle(null);
    render(<PortalHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal/login"));
  });
});
