// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINK_PROBLEM_TEXT, UI_TEXT } from "@/lib/voice";

import { CaptureFlow, formatRemaining } from "./capture-flow";

const TOKEN = "t".repeat(43);
let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

function started(minutesLeft: number) {
  return reply(200, {
    ok: true,
    state: "active",
    challengeCode: "K7Q2",
    sessionEndsAt: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no media playback; the voice clips are optional anyway.
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formatRemaining", () => {
  it("formats mm:ss and never goes negative", () => {
    expect(formatRemaining(40 * 60_000)).toBe("40:00");
    expect(formatRemaining(61_500)).toBe("01:02");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5_000)).toBe("00:00");
  });
});

describe("CaptureFlow session start", () => {
  it("shows no code before Start", () => {
    render(<CaptureFlow token={TOKEN} language="en" />);
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: UI_TEXT.en.start })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Start calls the start route, then reveals the code with a countdown", async () => {
    fetchMock.mockReturnValue(started(40));
    render(<CaptureFlow token={TOKEN} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));

    expect(await screen.findByTestId("challenge-code")).toHaveTextContent("K7Q2");
    expect(fetchMock).toHaveBeenCalledWith(`/api/t/${TOKEN}/start`, { method: "POST" });
    expect(screen.getByRole("timer")).toHaveTextContent(/Time left: (40:00|39:5\d)/);
    expect(screen.getByRole("button", { name: UI_TEXT.en.openCamera })).toBeInTheDocument();
  });

  it("offers Continue when the session was already started, and gets the code the same way", async () => {
    fetchMock.mockReturnValue(started(12));
    render(<CaptureFlow token={TOKEN} language="es" resumed />);
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.es.resume }));
    expect(await screen.findByTestId("challenge-code")).toHaveTextContent("K7Q2");
    expect(screen.getByRole("timer")).toHaveTextContent(UI_TEXT.es.timeLeft);
  });

  it.each(["link_expired", "session_expired", "submitted", "invalid"] as const)(
    "a %s start is a terminal failure with no code",
    async (state) => {
      fetchMock.mockReturnValue(reply(state === "invalid" ? 404 : 409, { ok: false, state }));
      render(<CaptureFlow token={TOKEN} language="en" />);
      fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
      expect(await screen.findByText(LINK_PROBLEM_TEXT.en[state])).toBeInTheDocument();
      expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: UI_TEXT.en.tryAgain })).not.toBeInTheDocument();
    },
  );

  it("a network failure on Start can be retried", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockReturnValueOnce(started(40));
    render(<CaptureFlow token={TOKEN} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    expect(await screen.findByText(UI_TEXT.en.startFailed)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.tryAgain }));
    expect(await screen.findByTestId("challenge-code")).toHaveTextContent("K7Q2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/t/${TOKEN}/start`);
  });

  it("disables Start while starting", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<CaptureFlow token={TOKEN} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    expect(await screen.findByRole("button", { name: UI_TEXT.en.starting })).toBeDisabled();
  });
});

describe("CaptureFlow countdown", () => {
  it("counts down and ends the session at zero", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fetchMock.mockReturnValue(started(1));
    render(<CaptureFlow token={TOKEN} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    await screen.findByTestId("challenge-code");
    expect(screen.getByRole("timer")).toHaveTextContent("01:00");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("00:30");

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.getByText(LINK_PROBLEM_TEXT.en.session_expired)).toBeInTheDocument();
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: UI_TEXT.en.tryAgain })).not.toBeInTheDocument();
  });
});
