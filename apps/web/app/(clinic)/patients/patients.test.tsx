// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeTestingToggle } from "./home-testing-toggle";
import { IssueLink, NETWORK_ERROR } from "./issue-link";
import { LinkDialog, ONCE_WARNING } from "./link-dialog";
import type { PatientRow } from "./load";
import { PatientsTable } from "./patients-table";

const PATIENT = "11000000-0000-0000-0000-000000000001";
const LINK = `https://pledgecheck.tech/t/${"a".repeat(43)}`;
const EXPIRES = "2026-09-27T15:00:00.000Z";

let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LinkDialog", () => {
  it("shows the link, a QR code, the expiry and the once-only warning, and no code", async () => {
    render(<LinkDialog issued={{ link: LINK, expiresAt: EXPIRES, setting: "home" }} pseudonym="PT-A1" onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Test link")).toHaveValue(LINK);
    expect(within(dialog).getByText(ONCE_WARNING)).toBeInTheDocument();
    expect(within(dialog).getByText(/Expires/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Expires/).querySelector("time")).toHaveAttribute("dateTime", EXPIRES);
    const qr = await within(dialog).findByAltText("QR code for the test link");
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(dialog.textContent).not.toMatch(/code:|challenge/i);
  });

  it("copies the link", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<LinkDialog issued={{ link: LINK, expiresAt: EXPIRES, setting: "home" }} pseudonym="PT-A1" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("renders nothing when no link is issued", () => {
    render(<LinkDialog issued={null} pseudonym="PT-A1" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("IssueLink", () => {
  it("issues a home link and opens the dialog", async () => {
    fetchMock.mockReturnValue(reply(200, { requestId: "r1", link: LINK, expiresAt: EXPIRES }));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Test link")).toHaveValue(LINK);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/requests",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ patientId: PATIENT, setting: "home" }) }),
    );
  });

  it("sends setting clinic for a clinic link", async () => {
    fetchMock.mockReturnValue(reply(200, { requestId: "r1", link: LINK, expiresAt: EXPIRES }));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Clinic link" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Clinic test link");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ patientId: PATIENT, setting: "clinic" });
  });

  it.each([
    ["not_permitted", "Home testing isn't turned on for this patient."],
    ["pre_treatment", "The first, pre-treatment test must be taken in the clinic."],
    ["cannot_get_pregnant", "Not eligible: this patient doesn't need pregnancy tests."],
  ])("surfaces the 409 refusal %s", async (reason, message) => {
    fetchMock.mockReturnValue(reply(409, { error: "home_testing_not_allowed", reason }));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(NETWORK_ERROR);
  });

  it("surfaces a 404 and a server error", async () => {
    fetchMock.mockReturnValueOnce(reply(404, { error: "not_found" })).mockReturnValueOnce(reply(500, { error: "issue_failed" }));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This patient isn't in your practice.");
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not issue the link. Try again."));
  });

  it("disables both buttons while issuing", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<IssueLink patientId={PATIENT} pseudonym="PT-A1" />);
    fireEvent.click(screen.getByRole("button", { name: "Home link" }));
    expect(await screen.findByRole("button", { name: "Issuing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clinic link" })).toBeDisabled();
  });
});

describe("HomeTestingToggle", () => {
  it("PATCHes the new value and shows it (not by color alone)", async () => {
    fetchMock.mockReturnValue(reply(200, { patientId: PATIENT, allowed: true, changed: true }));
    render(<HomeTestingToggle patientId={PATIENT} pseudonym="PT-A1" initial={false} />);
    const button = screen.getByRole("button", { name: "Home testing for PT-A1: off" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    const on = await screen.findByRole("button", { name: "Home testing for PT-A1: on" });
    expect(on).toHaveTextContent("On");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/patients/${PATIENT}/home-testing`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ allowed: true }) }),
    );
  });

  it("keeps the old value and surfaces an error on failure", async () => {
    fetchMock.mockReturnValue(reply(500, { error: "update_failed" }));
    render(<HomeTestingToggle patientId={PATIENT} pseudonym="PT-A1" initial={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Home testing/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update home testing");
    expect(screen.getByRole("button", { name: "Home testing for PT-A1: off" })).toBeInTheDocument();
  });

  it("shows the saved value but flags a missing audit entry", async () => {
    fetchMock.mockReturnValue(reply(500, { error: "audit_failed", changed: true, allowed: true }));
    render(<HomeTestingToggle patientId={PATIENT} pseudonym="PT-A1" initial={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Home testing/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("audit log entry failed");
    expect(screen.getByRole("button", { name: "Home testing for PT-A1: on" })).toBeInTheDocument();
  });

  it("surfaces a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    render(<HomeTestingToggle patientId={PATIENT} pseudonym="PT-A1" initial />);
    fireEvent.click(screen.getByRole("button", { name: /Home testing/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });
});

describe("PatientsTable", () => {
  const row: PatientRow = {
    id: PATIENT,
    pseudonym: "PT-A1",
    phase: "during",
    language: "es",
    canGetPregnant: true,
    homeTestingAllowed: true,
    latest: { state: "active", setting: "home", expiresAt: EXPIRES },
  };

  it("shows the empty state", () => {
    render(<PatientsTable patients={[]} />);
    expect(screen.getByText("No patients yet.")).toBeInTheDocument();
  });

  it("lists pseudonym, phase, language, eligibility, home testing and latest link state", () => {
    render(<PatientsTable patients={[row, { ...row, id: "p2", pseudonym: "PT-A2", latest: null, canGetPregnant: false }]} />);
    const [, first, second] = screen.getAllByRole("row");
    expect(first).toHaveTextContent("PT-A1");
    expect(first).toHaveTextContent("During treatment");
    expect(first).toHaveTextContent("Spanish");
    expect(first).toHaveTextContent("Session in progress (home)");
    expect(within(first).getByRole("button", { name: "Home testing for PT-A1: on" })).toBeInTheDocument();
    expect(second).toHaveTextContent("No link yet");
    expect(second).toHaveTextContent("No");
  });
});
