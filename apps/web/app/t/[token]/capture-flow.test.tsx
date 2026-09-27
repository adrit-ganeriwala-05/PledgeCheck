// @vitest-environment jsdom
import { act, configure, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// findBy* waits up to 1 s by default; a cold, heavily parallel run can take longer.
configure({ asyncUtilTimeout: 5000 });

import { LINK_PROBLEM_TEXT, UI_TEXT } from "@/lib/voice";

import { CaptureFlow, formatRemaining } from "./capture-flow";
import { PATIENT_COPY } from "./copy";

const TOKEN = "t".repeat(43);
let fetchMock: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

/** jsdom has no camera. A MediaStream only has to be stoppable and identifiable here. */
function fakeStream() {
  const track = { stop: vi.fn(), kind: "video" };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  getUserMedia.mockResolvedValue(stream);
  return stream;
}

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
  // jsdom has no navigator.mediaDevices at all, so it has to be defined, not just spied on.
  getUserMedia = vi.fn().mockRejectedValue(new DOMException("no camera", "NotFoundError"));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Welcome, then "how to photograph", where Start lives. */
function goToStart(language: "en" | "es" = "en") {
  fireEvent.click(screen.getByRole("button", { name: PATIENT_COPY[language].next }));
}

describe("formatRemaining", () => {
  it("formats mm:ss and never goes negative", () => {
    expect(formatRemaining(40 * 60_000)).toBe("40:00");
    expect(formatRemaining(61_500)).toBe("01:02");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5_000)).toBe("00:00");
  });
});

describe("CaptureFlow session start", () => {
  it("shows no code before Start, on the welcome or the how-to step", () => {
    const { container } = render(<CaptureFlow token={TOKEN} language="en" />);
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    goToStart();
    expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: UI_TEXT.en.start })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toMatch(/K7Q2/);
  });

  it("has no file input and no gallery upload anywhere", () => {
    const { container } = render(<CaptureFlow token={TOKEN} language="en" />);
    expect(container.querySelector("input[type=file]")).toBeNull();
    goToStart();
    expect(container.querySelector("input[type=file]")).toBeNull();
  });

  it("switches language and voice guidance on the welcome step", () => {
    render(<CaptureFlow token={TOKEN} language="en" />);
    fireEvent.click(screen.getByRole("radio", { name: "Español" }));
    expect(screen.getByRole("heading", { name: PATIENT_COPY.es.welcomeTitle })).toBeInTheDocument();
    const voice = screen.getByRole("button", { name: PATIENT_COPY.es.voiceLabel });
    expect(voice).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(voice);
    expect(voice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(voice);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("/audio/es/welcome.mp3");
  });

  it("Start calls the start route, then reveals the code with a countdown", async () => {
    fetchMock.mockReturnValue(started(40));
    render(<CaptureFlow token={TOKEN} language="en" />);
    goToStart();
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));

    expect(await screen.findByTestId("challenge-code")).toHaveTextContent("K7Q2");
    expect(fetchMock).toHaveBeenCalledWith(`/api/t/${TOKEN}/start`, { method: "POST" });
    expect(screen.getByRole("timer")).toHaveTextContent(/Time left: (40:00|39:5\d)/);
    expect(screen.getByRole("button", { name: UI_TEXT.en.openCamera })).toBeInTheDocument();
  });

  it("shows the live camera: the stream reaches the <video>, even if no animation frame runs", async () => {
    // The bug this pins: the stream used to be attached inside a one-shot
    // requestAnimationFrame fired right after setPhase("camera"). If that frame ran before
    // React committed the <video>, the ref was null and nothing ever retried — a black
    // screen with the code and shutter over it. Here rAF never fires at all, which is the
    // worst case of that race, and the preview must still come up.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const stream = fakeStream();
    fetchMock.mockReturnValue(started(40));

    render(<CaptureFlow token={TOKEN} language="en" />);
    goToStart();
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    await screen.findByTestId("challenge-code");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.openCamera }));
    });

    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.srcObject).toBe(stream);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    // No error shown, and the shutter is there to press.
    expect(screen.queryByText(UI_TEXT.en.cameraBlocked)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: PATIENT_COPY.en.shutter })).toBeInTheDocument();
  });

  it("a refused camera says so and stays on the code step", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    fetchMock.mockReturnValue(started(40));

    render(<CaptureFlow token={TOKEN} language="en" />);
    goToStart();
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    await screen.findByTestId("challenge-code");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.openCamera }));
    });

    expect(await screen.findByText(UI_TEXT.en.cameraBlocked)).toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeInTheDocument();
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
      goToStart();
      fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
      expect(await screen.findByText(LINK_PROBLEM_TEXT.en[state])).toBeInTheDocument();
      expect(screen.queryByTestId("challenge-code")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: UI_TEXT.en.tryAgain })).not.toBeInTheDocument();
    },
  );

  it("a network failure on Start can be retried", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockReturnValueOnce(started(40));
    render(<CaptureFlow token={TOKEN} language="en" />);
    goToStart();
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
    goToStart();
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    expect(await screen.findByRole("button", { name: UI_TEXT.en.starting })).toBeDisabled();
  });
});

describe("CaptureFlow countdown", () => {
  it("counts down and ends the session at zero", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    fetchMock.mockReturnValue(started(1));
    render(<CaptureFlow token={TOKEN} language="en" />);
    goToStart();
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.en.start }));
    await screen.findByTestId("challenge-code");
    // The code is on screen once React commits; flush effects so the countdown interval
    // exists before the fake clock moves (otherwise this races under a loaded test run).
    await act(async () => {});
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
