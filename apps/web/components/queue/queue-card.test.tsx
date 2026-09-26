// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeCard } from "@/test/queue-card-fixture";

import { QueueCard } from "./queue-card";
import { closerReviewReasons } from "./review-reasons";

describe("QueueCard: needs_review treatment", () => {
  it("shows a 'Needs closer review' header with specific reasons and amber styling", () => {
    const card = makeCard({
      status: "needs_review",
      opencv: { result: "positive", confidence: 0.5 },
      readersAgree: false,
      flags: ["readers_disagree"],
    });
    const { container } = render(<QueueCard card={card} onResolved={vi.fn()} />);

    expect(screen.getByText("Needs closer review")).toBeInTheDocument();
    const article = container.querySelector('[data-status="needs_review"]');
    expect(article?.className).toMatch(/border-amber/);
    const reasons = screen.getByText("Needs closer review").parentElement!.querySelector("ul")!;
    expect(within(reasons).getByText("Readers disagree: Grok negative · OpenCV positive")).toBeInTheDocument();
    expect(within(reasons).getByText("Low OpenCV confidence (50%)")).toBeInTheDocument();
    expect(within(reasons).getByText("Flag: Readers disagree")).toBeInTheDocument();
  });

  it("ready_for_review is neutral: no amber, no closer-review header", () => {
    const { container } = render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    expect(screen.queryByText("Needs closer review")).not.toBeInTheDocument();
    expect(screen.getByText("Ready for review")).toBeInTheDocument();
    expect(container.querySelector('[data-status="ready_for_review"]')?.className ?? "").not.toMatch(/amber/);
  });
});

describe("QueueCard: flags", () => {
  it("renders known flags with labels and unknown flags raw, never dropping any", () => {
    render(<QueueCard card={makeCard({ flags: ["code_mismatch", "mystery_flag_v2"] })} onResolved={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Flags" });
    expect(within(list).getByText("Code mismatch")).toBeInTheDocument();
    const unknown = within(list).getByText("mystery_flag_v2");
    expect(unknown).toHaveAttribute("title", "Unrecognized flag, shown as received");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("QueueCard: reads and permissions", () => {
  it("shows both reads side by side as evidence", () => {
    render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    expect(screen.getByText("Grok read")).toBeInTheDocument();
    expect(screen.getByText("OpenCV read")).toBeInTheDocument();
    expect(screen.getByText("Readers agree: Grok negative · OpenCV negative")).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("staff see a read-only card", () => {
    render(<QueueCard card={makeCard({ canReview: false })} onResolved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("shows 'photo unavailable' when there is no photo", () => {
    render(<QueueCard card={makeCard({ photoUrl: null })} onResolved={vi.fn()} />);
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
  });
});

describe("closerReviewReasons", () => {
  it("treats exactly 0.85 as not low (the PRD passes reads at 0.85 or more)", () => {
    const reasons = closerReviewReasons(
      makeCard({ status: "needs_review", grok: { result: "negative", code: "K7Q2", confidence: 0.85, codeMatches: true }, opencv: { result: "negative", confidence: 0.84 } }),
    );
    expect(reasons).toEqual(["Low OpenCV confidence (84%)"]);
  });

  it("lists low Grok confidence with its value and a code mismatch", () => {
    const reasons = closerReviewReasons(
      makeCard({ status: "needs_review", grok: { result: "negative", code: "X0X0", confidence: 0.62, codeMatches: false } }),
    );
    expect(reasons).toEqual(["Low Grok confidence (62%)", "Code read does not match the issued code"]);
  });
});
