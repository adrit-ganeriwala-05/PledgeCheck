// One-time link tokens. The plain token appears once, in the link given to the patient;
// only its SHA-256 hash is stored (test_requests.token_hash).
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export { generateChallengeCode as newChallengeCode } from "./code";

/** 32 random bytes, base64url (43 characters). Never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lowercase hex SHA-256 of the token. The only form that reaches the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Name kept from the interim pipeline version (labib/p0-integrated).
export const newToken = generateToken;
