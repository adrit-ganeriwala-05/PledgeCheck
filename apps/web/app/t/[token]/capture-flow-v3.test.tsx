// @vitest-environment jsdom
// v3 link states (PRD R6, R7, R13): signed out, wrong account, retired links, code expiry.
import { act, configure, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({ replace: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut } }),
}));

import { LINK_PROBLEM_TEXT, UI_TEXT } from "@/lib/voice";

import { CaptureFlow } from "./capture-flow";
import { PATIENT_COPY } from "./copy";
import { LinkProblem } from "./link-problem";

const TOKEN = "v".repeat(43);
let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function started(minutes: number, codeMinutes?: number) {
  return reply(200, {
    ok: true,
    state: "active",
    challengeCode: "K7Q2",
    sessionEndsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    ...(codeMinutes === undefined ? {} : { codeExpiresAt: new Date(Date.now() + codeMinutes * 60_000).toISOString() }),
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tapStart(language: "en" | "es" = "en") {
  fireEvent.click(screen.getByRole("button", { name: PATIENT_COPY[language].next }));
  fireEvent.click(screen.getByRole("button", { name: UI_TEXT[language].start }));
}

describe("signed out (401 not_logged_in)", () => {
  it("signs in right on the link, then starts without a code on screen beforehand", async () => {
    fetchMock.mockReturnValueOnce(reply(401, { ok: false, error: "not_logged_in" })).mockReturnValueOnce(started(40));
    const { container } = render(<CaptureFlow token={TOKEN} language="en" />);
    tapStart();
    expect(await screen.findByRole("heading", { name: PATIENT_COPY.en.signInTitle })).toBeInTheDocument();
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("K7Q2");
    // The token never ends up in a login URL.
    expect(container.innerHTML).not.toContain(TOKEN);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pt@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("challenge-code")).toHaveTextContent("K7Q2");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses the patient's language on the sign-in step", async () => {
    fetchMock.mockReturnValueOnce(reply(401, {}));
    render(<CaptureFlow token={TOKEN} language="es" />);
    tapStart("es");
    expect(await screen.findByRole("heading", { name: PATIENT_COPY.es.signInTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(PATIENT_COPY.es.form.email)).toBeInTheDocument();
  });
});

describe("wrong account (403 wrong_patient)", () => {
  it("explains, offers sign-out, then shows the sign-in form", async () => {
    fetchMock.mockReturnValueOnce(reply(403, { ok: false, error: "wrong_patient" }));
    render(<CaptureFlow token={TOKEN} language="en" />);
    tapStart();
    expect(await screen.findByRole("heading", { name: PATIENT_COPY.en.wrongPatientTitle })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: PATIENT_COPY.en.signOut }));
    expect(await screen.findByRole("heading", { name: PATIENT_COPY.en.signInTitle })).toBeInTheDocument();
    expect(mocks.signOut).toHaveBeenCalled();
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
  });
});

describe("retired links (410)", () => {
  it.each(["invalidated", "expired", "already_used"] as const)("%s: explains, no retry, and points to the portal", async (state) => {
    fetchMock.mockReturnValueOnce(reply(410, { ok: false, error: state }));
    render(<CaptureFlow token={TOKEN} language="en" />);
    tapStart();
    expect(await screen.findByText(LINK_PROBLEM_TEXT.en[state])).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: UI_TEXT.en.tryAgain })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: PATIENT_COPY.en.goToPortal })).toHaveAttribute("href", "/portal");
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
  });

  it("the server-rendered link problem also points to the portal, in Spanish too", () => {
    render(<LinkProblem state="invalidated" language="es" />);
    expect(screen.getByText(LINK_PROBLEM_TEXT.es.invalidated)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PATIENT_COPY.es.goToPortal })).toHaveAttribute("href", "/portal");
  });
});

describe("code expiry (R13)", () => {
  it("counts down to codeExpiresAt when it comes first, then sends the patient back to the portal", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fetchMock.mockReturnValue(started(40, 1));
    render(<CaptureFlow token={TOKEN} language="en" />);
    tapStart();
    await screen.findByTestId("challenge-code");
    await act(async () => {});
    expect(screen.getByRole("timer")).toHaveTextContent("01:00");
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText(LINK_PROBLEM_TEXT.en.code_expired)).toBeInTheDocument();
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: PATIENT_COPY.en.goToPortal })).toBeInTheDocument();
  });

  it("without codeExpiresAt, the session deadline is the only clock", async () => {
    fetchMock.mockReturnValue(started(12));
    render(<CaptureFlow token={TOKEN} language="en" />);
    tapStart();
    await screen.findByTestId("challenge-code");
    expect(screen.getByRole("timer")).toHaveTextContent(/(12:00|11:5\d)/);
  });
});
