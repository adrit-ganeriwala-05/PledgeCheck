import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, codesMatch, generateChallengeCode } from "./code";

describe("generateChallengeCode", () => {
  it("uses only the non-ambiguous alphabet over 10,000 generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = generateChallengeCode();
      expect(code).toHaveLength(4);
      for (const ch of code) {
        expect(CODE_ALPHABET).toContain(ch);
        seen.add(ch);
      }
      expect(code).not.toMatch(/[0O1IL]/);
    }
    // Every character of the alphabet shows up.
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });

  it("excludes ambiguous characters from the alphabet", () => {
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  });
});

describe("codesMatch", () => {
  it.each([
    ["K7Q2", "K7Q2", true],
    ["K7Q2", "k7q2", true],
    ["K7Q2", " K7 Q2 ", true],
    ["K7Q2", "K 7\tQ 2", true],
    ["K7Q2", "K7Q3", false],
    ["K7Q2", "K7Q", false],
    ["K7Q2", "", false],
    ["K7Q2", "   ", false],
    ["K7Q2", null, false],
    ["K7Q2", undefined, false],
  ])("codesMatch(%j, %j) is %s", (expected, read, result) => {
    expect(codesMatch(expected, read)).toBe(result);
  });
});
