// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PatientRow } from "./load";

const mocks = vi.hoisted(() => ({ generateEnrollmentCode: vi.fn(), getPortalStatuses: vi.fn() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  generateEnrollmentCode: mocks.generateEnrollmentCode,
  getPortalStatuses: mocks.getPortalStatuses,
}));

const { CODE_ONCE_WARNING, EnrollmentCode } = await import("./enrollment-code");
const { PatientsTable } = await import("./patients-table");

const EXPIRES = "2026-09-30T15:00:00.000Z";

function row(id: string, pseudonym: string, extra: Partial<PatientRow> = {}): PatientRow {
  return { id, pseudonym, phase: "during", language: "en", canGetPregnant: true, homeTestingAllowed: true, latest: null, ...extra };
}

beforeEach(() => vi.clearAllMocks());

describe("EnrollmentCode", () => {
  it("shows the code once with copy, expiry and the warning", async () => {
    mocks.generateEnrollmentCode.mockResolvedValue({ ok: true, data: { code: "K4M9-TQ2P", expiresAt: EXPIRES } });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<EnrollmentCode patientId="p1" pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Enrollment code for PT-A1" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("enrollment-code")).toHaveTextContent("K4M9-TQ2P");
    expect(within(dialog).getByText(CODE_ONCE_WARNING)).toBeInTheDocument();
    expect(within(dialog).getByText(/Expires/).querySelector("time")).toHaveAttribute("dateTime", EXPIRES);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("K4M9-TQ2P"));
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("is gone once the dialog closes", async () => {
    mocks.generateEnrollmentCode.mockResolvedValue({ ok: true, data: { code: "K4M9-TQ2P", expiresAt: EXPIRES } });
    render(<EnrollmentCode patientId="p1" pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Enrollment code for PT-A1" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("K4M9-TQ2P")).not.toBeInTheDocument());
  });

  it.each([
    ["already_enrolled", "This patient already has a portal account."],
    ["not_found", "This patient isn't in your practice."],
    ["network_error", "Network error"],
    ["not_available", "aren't available on this server yet"],
  ])("explains %s", async (code, text) => {
    mocks.generateEnrollmentCode.mockResolvedValue({ ok: false, error: { code, status: 409 } });
    const onAlreadyEnrolled = vi.fn();
    render(<EnrollmentCode patientId="p1" pseudonym="PT-A1" onAlreadyEnrolled={onAlreadyEnrolled} />);
    fireEvent.click(screen.getByRole("button", { name: "Enrollment code for PT-A1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(onAlreadyEnrolled).toHaveBeenCalledTimes(code === "already_enrolled" ? 1 : 0);
  });
});

describe("PatientsTable portal column", () => {
  it("shows enrolled and not-enrolled patients, their cycle, and a code only for the unenrolled", async () => {
    mocks.getPortalStatuses.mockResolvedValue({
      ok: true,
      data: {
        patients: [
          { patientId: "p1", enrolled: true, cycleStatus: "requested" },
          { patientId: "p2", enrolled: false, cycleStatus: null },
        ],
      },
    });
    render(<PatientsTable patients={[row("p1", "PT-A1"), row("p2", "PT-A2")]} />);
    const [, first, second] = screen.getAllByRole("row");
    await within(first).findByText("Enrolled");
    expect(within(first).getByText("Refill requested")).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: /Enrollment code/ })).not.toBeInTheDocument();
    expect(within(second).getByText("Not enrolled")).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "Enrollment code for PT-A2" })).toBeInTheDocument();
    // The v2 link issuing still works alongside.
    expect(within(second).getByRole("button", { name: "Home link" })).toBeInTheDocument();
  });

  it("shows a dash when the backend has no portal status yet", async () => {
    mocks.getPortalStatuses.mockResolvedValue({ ok: false, error: { code: "not_available", status: 404 } });
    render(<PatientsTable patients={[row("p1", "PT-A1")]} />);
    expect(await screen.findByTitle("Portal status isn't available from the server yet")).toHaveTextContent("—");
  });
});
