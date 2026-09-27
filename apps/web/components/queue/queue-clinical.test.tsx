// @vitest-environment jsdom
// Clinical safety (PRD v3): a faint test line is never shown as a clean or negative read.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeCard } from "@/test/queue-card-fixture";

import { clinicalAlert, flagLabel, flagSeverity, FLAGS, sortFlags } from "./flags";
import { QueueCard } from "./queue-card";
import { sortByUrgency } from "./sort";

describe("flag vocabulary", () => {
  it("faint_test_line is labeled and high (clinical) severity", () => {
    expect(flagLabel("faint_test_line")).toEqual({ label: "Faint test line: possible positive", known: true });
    expect(flagSeverity("faint_test_line")).toBe("clinical");
  });

  it("every known flag has a label and a severity", () => {
    for (const [flag, info] of Object.entries(FLAGS)) {
      expect(info.label, flag).toBeTruthy();
      expect(["clinical", "fraud", "degraded", "review"]).toContain(flagSeverity(flag));
    }
  });

  it("a positive-result engine reason is clinical too", () => {
    expect(flagSeverity("positive result; prescriber must contact the patient before any fill")).toBe("clinical");
  });

  it("clinical flags sort before fraud, degraded, review and unknown", () => {
    expect(sortFlags(["mystery", "low_confidence", "opencv_unavailable", "photo_already_used", "faint_test_line"])).toEqual([
      "faint_test_line",
      "photo_already_used",
      "opencv_unavailable",
      "low_confidence",
      "mystery",
    ]);
  });

  it("unknown flags still render safely, as received", () => {
    expect(flagLabel("brand_new_flag")).toEqual({ label: "brand_new_flag", known: false });
    expect(flagSeverity("brand_new_flag")).toBe("unknown");
  });
});

describe("a faint test line on the card", () => {
  const faint = makeCard({
    status: "ready_for_review",
    grok: { result: "negative", code: "K7Q2", confidence: 0.93, codeMatches: true, controlLine: true, testLine: "faint" },
    flags: ["faint_test_line"],
  });

  it("shows a high-severity banner and never 'Ready for review'", () => {
    render(<QueueCard card={faint} onResolved={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Faint test line detected");
    expect(screen.queryByText("Ready for review")).not.toBeInTheDocument();
  });

  it("never shows a reader's 'negative' or a green agreement", () => {
    const { container } = render(<QueueCard card={faint} onResolved={vi.fn()} />);
    const reads = screen.getByRole("region", { name: "Independent reads" });
    expect(within(reads).queryByText(/^negative$/i)).not.toBeInTheDocument();
    expect(within(reads).getAllByText("Possible positive")).toHaveLength(2);
    expect(container.querySelector('[data-agreement="agree"]')).toBeNull();
    expect(container.querySelector('[data-agreement="clinical"]')).toHaveTextContent("don't treat this test as negative");
  });

  it("renders the faint_test_line chip first, with the clinical style", () => {
    render(<QueueCard card={{ ...faint, flags: ["low_confidence", "faint_test_line"] }} onResolved={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: "Flags" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Faint test line: possible positive");
    expect(items[0].querySelector("[data-severity]")).toHaveAttribute("data-severity", "clinical");
  });

  it("the testLine field alone is enough, even without the flag", () => {
    expect(clinicalAlert({ flags: [], grok: { testLine: "faint" } })).toMatch(/Faint test line/);
    expect(clinicalAlert({ flags: [], grok: { testLine: "clear" } })).toMatch(/test line was detected/);
    expect(clinicalAlert({ flags: [], grok: { testLine: "none" } })).toBeNull();
  });

  it("sorts first in the queue", () => {
    const early = makeCard({ submissionId: "a", window: { opensAt: "2026-09-20T00:00:00Z", closesAt: "2026-09-27T00:00:00Z", isFirstRx: false } });
    const card = { ...faint, submissionId: "f" };
    expect(sortByUrgency([early, card]).map((c) => c.submissionId)).toEqual(["f", "a"]);
  });
});

describe("explicit Grok fields (R8)", () => {
  it("shows control line, test line, confidence and the code against the issued one", () => {
    render(
      <QueueCard
        card={makeCard({ grok: { result: "negative", code: "K7Q2", confidence: 0.7, codeMatches: true, controlLine: true, testLine: "none", expectedCode: "K7Q2" } })}
        onResolved={vi.fn()}
      />,
    );
    const fields = screen.getByLabelText("What Grok reported");
    expect(fields.querySelector('[data-field="control-line"]')).toHaveTextContent("Present");
    expect(fields.querySelector('[data-field="test-line"]')).toHaveTextContent("None seen");
    expect(fields.querySelector('[data-field="confidence"]')).toHaveTextContent("70% · below 85%");
    expect(screen.getByText(/^Code read/)).toHaveTextContent("Code read K7Q2 · issued K7Q2");
  });

  it("says 'Not reported' when the pipeline hasn't sent the v3 fields", () => {
    render(<QueueCard card={makeCard()} onResolved={vi.fn()} />);
    const dl = screen.getByLabelText("What Grok reported");
    expect(dl.querySelector('[data-field="control-line"]')).toHaveTextContent("Not reported");
    expect(dl.querySelector('[data-field="test-line"]')).toHaveTextContent("Not reported");
  });

  it("a missing control line reads as an invalid test", () => {
    render(<QueueCard card={makeCard({ grok: { result: "invalid", code: "K7Q2", confidence: 0.9, codeMatches: true, controlLine: false } })} onResolved={vi.fn()} />);
    expect(screen.getByLabelText("What Grok reported").querySelector('[data-field="control-line"]')).toHaveTextContent("Missing: test invalid");
  });
});
