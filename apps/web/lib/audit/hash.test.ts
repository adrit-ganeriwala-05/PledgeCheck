import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeHash, GENESIS_PREV_HASH, hashedFields, normalizeTimestamp } from "./hash";

const row = {
  seq: 1,
  actor: "clinician:a0000000-0000-0000-0000-000000000001",
  action: "review.approved",
  ref_id: "a3000001-0000-0000-0000-000000000000",
  payload: { submission_id: "a3000001-0000-0000-0000-000000000000", decision: "approved" },
  created_at: "2026-09-26T14:30:00.123Z",
};

describe("normalizeTimestamp", () => {
  it("normalizes Postgres and JS forms of the same instant", () => {
    expect(normalizeTimestamp("2026-09-26T14:30:00.123+00:00")).toBe("2026-09-26T14:30:00.123Z");
    expect(normalizeTimestamp("2026-09-26T10:30:00.123-04:00")).toBe("2026-09-26T14:30:00.123Z");
    expect(normalizeTimestamp(new Date("2026-09-26T14:30:00.123Z"))).toBe("2026-09-26T14:30:00.123Z");
  });

  it("throws on an invalid timestamp", () => {
    expect(() => normalizeTimestamp("not a date")).toThrow();
  });
});

describe("hashedFields", () => {
  it("returns exactly the hashed fields with normalized types", () => {
    const fields = hashedFields({ ...row, seq: "7", ref_id: null, payload: null });
    expect(fields).toEqual({
      seq: 7,
      actor: row.actor,
      action: row.action,
      ref_id: null,
      payload: {},
      created_at: row.created_at,
    });
    expect(Object.keys(fields).sort()).toEqual(["action", "actor", "created_at", "payload", "ref_id", "seq"]);
  });

  it("ignores stored prev_hash and hash", () => {
    const withStored = { ...row, prev_hash: "x", hash: "y" };
    expect(computeHash(GENESIS_PREV_HASH, withStored)).toBe(computeHash(GENESIS_PREV_HASH, row));
  });
});

describe("computeHash", () => {
  it("hashes +00:00 and Z timestamps for the same instant identically", () => {
    expect(computeHash(GENESIS_PREV_HASH, { ...row, created_at: "2026-09-26T14:30:00.123+00:00" })).toBe(
      computeHash(GENESIS_PREV_HASH, row),
    );
  });

  it("equals sha256(prev_hash + canonical JSON)", () => {
    const expected = createHash("sha256")
      .update(
        GENESIS_PREV_HASH +
          '{"action":"review.approved","actor":"clinician:a0000000-0000-0000-0000-000000000001",' +
          '"created_at":"2026-09-26T14:30:00.123Z","payload":{"decision":"approved",' +
          '"submission_id":"a3000001-0000-0000-0000-000000000000"},' +
          '"ref_id":"a3000001-0000-0000-0000-000000000000","seq":1}',
      )
      .digest("hex");
    expect(computeHash(GENESIS_PREV_HASH, row)).toBe(expected);
  });

  it("matches the pinned test vector (spec v1)", () => {
    // TEST VECTOR, not a secret: guards against accidental changes to the hash spec.
    expect(computeHash(GENESIS_PREV_HASH, row)).toBe(
      "5a1501da40a473e3884a829ee7f8270e04e54b02cbacd4aeb984ef3fb00ab3ac",
    );
  });

  it("changes when prev_hash or any field changes", () => {
    const base = computeHash(GENESIS_PREV_HASH, row);
    expect(computeHash("f".repeat(64), row)).not.toBe(base);
    expect(computeHash(GENESIS_PREV_HASH, { ...row, payload: { decision: "rejected" } })).not.toBe(base);
    expect(computeHash(GENESIS_PREV_HASH, { ...row, seq: 2 })).not.toBe(base);
  });
});
