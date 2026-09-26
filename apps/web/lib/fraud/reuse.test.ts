import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { phashDb, phashWithBits } from "@/test/phash-db";

import { checkReuse, findClosestPhash, hamming, PhashFormatError, REUSE_DISTANCE } from "./reuse";

const ZERO = "0000000000000000";
const asDb = (c: unknown) => c as SupabaseClient;

describe("hamming", () => {
  it("counts differing bits on known pairs", () => {
    expect(hamming(ZERO, ZERO)).toBe(0);
    expect(hamming("c3a1f09e5b7d2e44", "c3a1f09e5b7d2e44")).toBe(0);
    expect(hamming(ZERO, "0000000000000001")).toBe(1);
    expect(hamming(ZERO, "8000000000000000")).toBe(1);
    expect(hamming(ZERO, "ffffffffffffffff")).toBe(64);
    expect(hamming("ABCDEF0123456789", "abcdef0123456789")).toBe(0);
    expect(hamming(ZERO, phashWithBits(7))).toBe(7);
  });

  it.each([
    ["short", "abc"],
    ["long", "00000000000000000"],
    ["non-hex", "000000000000000g"],
    ["empty", ""],
  ])("throws on malformed input: %s", (_label, bad) => {
    expect(() => hamming(bad, ZERO)).toThrow(PhashFormatError);
    expect(() => hamming(ZERO, bad)).toThrow(PhashFormatError);
  });
});

describe("findClosestPhash / checkReuse", () => {
  it("uses the PRD threshold: distance < 8 matches", () => {
    expect(REUSE_DISTANCE).toBe(8);
  });

  it("matches at distance 7", async () => {
    const db = phashDb([{ id: "s1", phash: phashWithBits(7) }]);
    expect(await checkReuse(asDb(db.client), ZERO)).toEqual({ reused: true, matchedSubmissionId: "s1", distance: 7 });
  });

  it("does not match at distance 8", async () => {
    const db = phashDb([{ id: "s1", phash: phashWithBits(8) }]);
    expect(await checkReuse(asDb(db.client), ZERO)).toEqual({ reused: false });
  });

  it("reports the closest earlier submission", async () => {
    const db = phashDb([
      { id: "far", phash: phashWithBits(6) },
      { id: "near", phash: phashWithBits(2) },
    ]);
    expect(await findClosestPhash(asDb(db.client), ZERO)).toEqual({ submissionId: "near", distance: 2 });
  });

  it("honors excludeSubmissionId", async () => {
    const db = phashDb([
      { id: "self", phash: ZERO },
      { id: "other", phash: phashWithBits(20) },
    ]);
    expect(await checkReuse(asDb(db.client), ZERO, "self")).toEqual({ reused: false });
  });

  it("skips malformed stored hashes", async () => {
    const db = phashDb([
      { id: "bad", phash: "nope" },
      { id: "null", phash: null },
      { id: "ok", phash: phashWithBits(3) },
    ]);
    expect(await findClosestPhash(asDb(db.client), ZERO)).toEqual({ submissionId: "ok", distance: 3 });
  });

  it("pages through more than 1000 stored rows", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `s${i}`, phash: "ffffffffffffffff" }));
    rows[2400] = { id: "match", phash: phashWithBits(1) };
    const db = phashDb(rows);
    expect(await findClosestPhash(asDb(db.client), ZERO)).toEqual({ submissionId: "match", distance: 1 });
    expect(db.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("requests one more page when a page is exactly full", async () => {
    const db = phashDb(Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, phash: "ffffffffffffffff" })));
    await findClosestPhash(asDb(db.client), ZERO);
    expect(db.ranges).toHaveLength(2);
  });

  it("returns null with nothing to compare", async () => {
    expect(await findClosestPhash(asDb(phashDb([]).client), ZERO)).toBeNull();
  });

  it("findClosestPhash throws on a malformed input hash", async () => {
    await expect(findClosestPhash(asDb(phashDb([]).client), "xyz")).rejects.toBeInstanceOf(PhashFormatError);
  });

  it("checkReuse (interim interface) logs and reports not reused on malformed input or a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkReuse(asDb(phashDb([]).client), "xyz")).toEqual({ reused: false });
    expect(await checkReuse(asDb(phashDb([], { message: "down" }).client), ZERO)).toEqual({ reused: false });
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
