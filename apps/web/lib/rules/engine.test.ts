// The 7 unit tests the PRD asks for, written before the engine shipped, plus a
// few that cover the edges the demo will be poked at. Owner: Labib (L3).

import { describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLD, evaluate, WINDOW_DAYS } from "./engine";
import type { Patient, Read, Submission } from "./types";

const NOW = new Date("2026-09-26T15:00:00.000Z");

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p-1",
    canGetPregnant: true,
    homeTestingAllowed: true,
    phase: "during",
    treatmentStart: "2026-08-15",
    language: "en",
    lastWindow: null,
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "s-1",
    setting: "home",
    isFirstRx: false,
    capturedAt: NOW.toISOString(),
    challengeCode: "K7Q2",
    flags: [],
    ...overrides,
  };
}

function reads(overrides: { grok?: Partial<Read>; cv?: Partial<Read> } = {}): Read[] {
  return [
    { source: "grok", result: "negative", confidence: 0.93, codeRead: "K7Q2", ...overrides.grok },
    { source: "cv", result: "negative", confidence: 0.88, ...overrides.cv },
  ];
}

describe("rules engine", () => {
  it("1. blocks a home test taken before treatment starts", () => {
    const result = evaluate(
      patient({ phase: "pre", treatmentStart: null }),
      submission({ isFirstRx: true }),
      reads(),
      NOW,
    );

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("medical setting");
    expect(result.window).toBeNull();
  });

  it("2. blocks a home test for a patient without home testing allowed", () => {
    const result = evaluate(
      patient({ homeTestingAllowed: false }),
      submission(),
      reads(),
      NOW,
    );

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("home testing not permitted");
  });

  it("3. returns ready_for_review when both readers agree at 0.9", () => {
    const result = evaluate(
      patient(),
      submission(),
      reads({ grok: { confidence: 0.9 }, cv: { confidence: 0.9 } }),
      NOW,
    );

    expect(result.decision).toBe("ready_for_review");
    expect(result.reasons).toContain("readers agree: negative");
    expect(result.reasons).toContain("code matches");
  });

  it("4. sends a reader disagreement to needs_review, never blocked", () => {
    const result = evaluate(
      patient(),
      submission(),
      reads({ cv: { result: "positive" } }),
      NOW,
    );

    expect(result.decision).toBe("needs_review");
    expect(result.reasons.join(" ")).toContain("readers disagree");
    expect(result.window).not.toBeNull();
  });

  it("5. closes the window exactly 7 days after verification", () => {
    const result = evaluate(patient(), submission(), reads(), NOW);

    expect(result.window).not.toBeNull();
    expect(result.window!.opensAt).toBe(NOW.toISOString());

    const elapsed =
      new Date(result.window!.closesAt).getTime() - new Date(result.window!.opensAt).getTime();
    expect(elapsed).toBe(WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(result.window!.closesAt).toBe("2026-10-03T15:00:00.000Z");
  });

  it("6. requires a clinic test after a missed first-Rx window", () => {
    const missed = patient({
      lastWindow: {
        isFirstRx: true,
        opensAt: "2026-09-10T15:00:00.000Z",
        closesAt: "2026-09-17T15:00:00.000Z",
        filledAt: null,
        status: "open",
      },
    });

    const atHome = evaluate(missed, submission({ setting: "home" }), reads(), NOW);
    expect(atHome.decision).toBe("blocked");
    expect(atHome.reasons.join(" ")).toContain("medical setting");

    // No waiting period: the clinic can repeat the test straight away.
    const inClinic = evaluate(missed, submission({ setting: "clinic" }), reads(), NOW);
    expect(inClinic.decision).toBe("ready_for_review");
  });

  it("7. never puts a patient who cannot get pregnant into the test loop", () => {
    const result = evaluate(
      patient({ canGetPregnant: false }),
      submission(),
      reads(),
      NOW,
    );

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("cannot get pregnant");
    expect(result.window).toBeNull();
  });
});

describe("rules engine, edges the demo will poke at", () => {
  it("blocks a wrong challenge code", () => {
    const result = evaluate(
      patient(),
      submission(),
      reads({ grok: { codeRead: "AB12" } }),
      NOW,
    );

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("code missing or wrong");
  });

  it("blocks a missing challenge code", () => {
    const result = evaluate(patient(), submission(), reads({ grok: { codeRead: null } }), NOW);

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("no code visible");
  });

  it("ignores case and spacing in the challenge code", () => {
    const result = evaluate(patient(), submission(), reads({ grok: { codeRead: " k7q2 " } }), NOW);

    expect(result.decision).toBe("ready_for_review");
  });

  it("blocks a submission that already failed a fraud check", () => {
    const result = evaluate(
      patient(),
      submission({ flags: ["photo_already_used"] }),
      reads(),
      NOW,
    );

    expect(result.decision).toBe("blocked");
    expect(result.reasons.join(" ")).toContain("photo_already_used");
  });

  it("sends a low-confidence read to needs_review", () => {
    const result = evaluate(
      patient(),
      submission(),
      reads({ cv: { confidence: CONFIDENCE_THRESHOLD - 0.01 } }),
      NOW,
    );

    expect(result.decision).toBe("needs_review");
    expect(result.reasons.join(" ")).toContain("below");
  });

  it("sends an agreed positive result to needs_review", () => {
    const result = evaluate(
      patient(),
      submission(),
      reads({ grok: { result: "positive" }, cv: { result: "positive" } }),
      NOW,
    );

    expect(result.decision).toBe("needs_review");
    expect(result.reasons.join(" ")).toContain("positive result");
  });

  it("sends a single reader to needs_review", () => {
    const result = evaluate(
      patient(),
      submission(),
      [{ source: "grok", result: "negative", confidence: 0.95, codeRead: "K7Q2" }],
      NOW,
    );

    expect(result.decision).toBe("needs_review");
    expect(result.reasons.join(" ")).toContain("only one reader");
  });

  it("allows the first in-clinic test before treatment starts", () => {
    const result = evaluate(
      patient({ phase: "pre", treatmentStart: null }),
      submission({ setting: "clinic", isFirstRx: true }),
      reads(),
      NOW,
    );

    expect(result.decision).toBe("ready_for_review");
  });

  it("is deterministic for the same inputs", () => {
    const a = evaluate(patient(), submission(), reads(), NOW);
    const b = evaluate(patient(), submission(), reads(), NOW);
    expect(a).toEqual(b);
  });
});
