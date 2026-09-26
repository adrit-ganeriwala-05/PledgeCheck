import { describe, expect, it } from "vitest";

import { LINK_PROBLEM_TEXT } from "@/lib/voice";

import { isTerminalReason, patientMessage } from "./capture-flow";

describe("upload rejection messages", () => {
  it.each([
    ["invalid_link", LINK_PROBLEM_TEXT.en.invalid],
    ["session_expired", LINK_PROBLEM_TEXT.en.session_expired],
    ["already_submitted", LINK_PROBLEM_TEXT.en.submitted],
  ])("%s gets the link-state message", (reason, message) => {
    expect(patientMessage(reason, "en")).toBe(message);
  });

  it("session_not_started tells the patient to tap Start, in both languages", () => {
    expect(patientMessage("session_not_started", "en")).toMatch(/tap Start/);
    expect(patientMessage("session_not_started", "es")).toMatch(/Comenzar/);
  });

  it("keeps the older reasons and the generic fallback", () => {
    expect(patientMessage("expired", "en")).toMatch(/expired/);
    expect(patientMessage("something_else", "en")).toBe("We could not accept this photo. Contact your clinic.");
  });

  it("treats every link rejection as terminal, but not a photo problem", () => {
    for (const reason of ["invalid_link", "session_not_started", "session_expired", "already_submitted", "expired"]) {
      expect(isTerminalReason(reason)).toBe(true);
    }
    expect(isTerminalReason(undefined)).toBe(false);
    expect(isTerminalReason("neither reader could process the photo; retake it")).toBe(false);
  });
});
