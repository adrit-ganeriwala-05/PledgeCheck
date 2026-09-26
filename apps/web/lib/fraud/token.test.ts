import { describe, expect, it } from "vitest";

import { generateToken, hashesEqual, hashToken, newChallengeCode, newToken } from "./token";

describe("token", () => {
  it("generates 43-character base64url tokens that differ each time", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically to 64 lowercase hex characters, unlike the token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
    expect(hashToken(generateToken())).not.toBe(hash);
  });

  it("matches a known SHA-256 test vector", () => {
    // TEST VECTOR: sha256("abc")
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compares hashes in constant time", () => {
    const h = hashToken("x");
    expect(hashesEqual(h, hashToken("x"))).toBe(true);
    expect(hashesEqual(h, hashToken("y"))).toBe(false);
    expect(hashesEqual(h, h.slice(1))).toBe(false);
  });

  it("keeps the interim pipeline names", () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newChallengeCode()).toMatch(/^[A-Z2-9]{4}$/);
  });
});
