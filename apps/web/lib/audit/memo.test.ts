import { describe, expect, it } from "vitest";

import { buildMemo, parseMemo } from "./memo";

const HASH = "ab".repeat(32); // test vector

describe("memo", () => {
  it("builds the v1 format", () => {
    expect(buildMemo(42, HASH)).toBe(`pledgecheck:v1:42:${HASH}`);
  });

  it("round-trips", () => {
    expect(parseMemo(buildMemo(42, HASH))).toEqual({ headSeq: 42, headHash: HASH });
  });

  it.each([
    ["wrong prefix", `pledgekheck:v1:42:${HASH}`],
    ["v2", `pledgecheck:v2:42:${HASH}`],
    ["uppercase hex", `pledgecheck:v1:42:${HASH.toUpperCase()}`],
    ["short hash", `pledgecheck:v1:42:${HASH.slice(2)}`],
    ["seq 0", `pledgecheck:v1:0:${HASH}`],
    ["negative seq", `pledgecheck:v1:-1:${HASH}`],
    ["leading zero seq", `pledgecheck:v1:042:${HASH}`],
    ["trailing text", `pledgecheck:v1:42:${HASH} `],
    ["extra field", `pledgecheck:v1:42:${HASH}:x`],
    ["empty", ""],
  ])("rejects %s", (_label, text) => {
    expect(parseMemo(text)).toBeNull();
  });

  it("refuses to build an invalid memo", () => {
    expect(() => buildMemo(0, HASH)).toThrow();
    expect(() => buildMemo(1, "xyz")).toThrow();
  });
});
