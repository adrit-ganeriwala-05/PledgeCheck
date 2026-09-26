import { describe, expect, it } from "vitest";

import {
  describeAgreement,
  describeCapturedAgo,
  describeCode,
  describeWindowCountdown,
  formatConfidence,
} from "./format";

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("describeAgreement", () => {
  const card = (grok: string | null, cv: string | null) => ({
    grok: { result: grok, code: null, confidence: null, codeMatches: null },
    opencv: { result: cv, confidence: null },
    readersAgree: grok !== null && grok === cv,
  });

  it("names both reads when they agree or disagree (never generic)", () => {
    expect(describeAgreement(card("negative", "negative"))).toBe("Readers agree: Grok negative · OpenCV negative");
    expect(describeAgreement(card("negative", "positive"))).toBe("Readers disagree: Grok negative · OpenCV positive");
  });

  it("says which read is missing", () => {
    expect(describeAgreement(card("negative", null))).toBe("OpenCV read unavailable · Grok negative");
    expect(describeAgreement(card(null, "invalid"))).toBe("Grok read unavailable · OpenCV invalid");
    expect(describeAgreement(card(null, null))).toBe("Both reads unavailable");
  });
});

describe("describeCode", () => {
  it("reports match, mismatch and no code", () => {
    expect(describeCode({ result: null, code: "K7Q2", confidence: null, codeMatches: true })).toMatch(/matches the issued code/);
    expect(describeCode({ result: null, code: "X0X0", confidence: null, codeMatches: false })).toMatch(/does not match/);
    expect(describeCode({ result: null, code: null, confidence: null, codeMatches: null })).toBe("No code read");
  });
});

describe("time formatting", () => {
  it("counts down to an existing window close", () => {
    expect(describeWindowCountdown("2026-10-01T15:00:00Z", NOW)).toBe("Window closes in 5d 3h");
    expect(describeWindowCountdown("2026-09-26T16:30:00Z", NOW)).toBe("Window closes in 4h 30m");
    expect(describeWindowCountdown("2026-09-26T11:00:00Z", NOW)).toBe("Window closed");
  });

  it("describes capture age", () => {
    expect(describeCapturedAgo("2026-09-26T09:00:00Z", NOW)).toBe("Captured 3h ago");
    expect(describeCapturedAgo("2026-09-26T11:50:00Z", NOW)).toBe("Captured 10m ago");
    expect(describeCapturedAgo("2026-09-24T10:00:00Z", NOW)).toBe("Captured 2d 2h ago");
    expect(describeCapturedAgo(null, NOW)).toBe("Capture time unknown");
  });

  it("formats confidence as a percentage", () => {
    expect(formatConfidence(0.938)).toBe("94%");
    expect(formatConfidence(null)).toBe("—");
  });
});
