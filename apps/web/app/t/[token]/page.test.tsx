// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LINK_PROBLEM_TEXT, UI_TEXT } from "@/lib/voice";

const mocks = vi.hoisted(() => ({ getLinkStatus: vi.fn() }));
vi.mock("@/lib/fraud/session", () => ({ getLinkStatus: mocks.getLinkStatus }));

const { default: CapturePage } = await import("./page");

const TOKEN = "p".repeat(43);

async function renderPage() {
  const element = await CapturePage({ params: Promise.resolve({ token: TOKEN }) });
  return render(element);
}

beforeEach(() => {
  mocks.getLinkStatus.mockReset();
});

describe("/t/[token] page", () => {
  it("ready: shows Start and no code", async () => {
    mocks.getLinkStatus.mockResolvedValue({ ok: true, state: "ready", language: "en", sessionEndsAt: null, challengeCode: null });
    await renderPage();
    expect(screen.getByRole("button", { name: UI_TEXT.en.start })).toBeInTheDocument();
    expect(mocks.getLinkStatus).toHaveBeenCalledWith(TOKEN, expect.any(Date));
  });

  it("active: offers Continue, and the code is still not on the page before the tap", async () => {
    mocks.getLinkStatus.mockResolvedValue({
      ok: true,
      state: "active",
      language: "es",
      sessionEndsAt: new Date(Date.now() + 600_000).toISOString(),
      challengeCode: "K7Q2",
    });
    const { container } = await renderPage();
    expect(screen.getByRole("button", { name: UI_TEXT.es.resume })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("K7Q2");
  });

  it.each([
    ["invalid", null],
    ["link_expired", "en"],
    ["session_expired", "es"],
    ["submitted", "en"],
  ] as const)("%s: explains the problem in the patient's language", async (state, language) => {
    mocks.getLinkStatus.mockResolvedValue({ ok: false, state, language, sessionEndsAt: null, challengeCode: null });
    await renderPage();
    const lang = language ?? "en";
    expect(screen.getByRole("heading")).toHaveTextContent(UI_TEXT[lang].linkProblem);
    expect(screen.getByText(LINK_PROBLEM_TEXT[lang][state])).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a lookup failure shows a generic problem", async () => {
    mocks.getLinkStatus.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.getByText(LINK_PROBLEM_TEXT.en.error)).toBeInTheDocument();
  });
});
