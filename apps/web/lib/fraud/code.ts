// The 4-character challenge code the patient writes on the test. Generated with the
// link (challenge_code is NOT NULL) but revealed only when the patient taps Start.
import "server-only";

import { randomInt } from "node:crypto";

/** No 0 O 1 I L: easily confused in handwriting. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

export function generateChallengeCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function normalize(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/** Trim, uppercase and drop spaces, then compare exactly. A missing read never matches. */
export function codesMatch(expected: string, read: string | null | undefined): boolean {
  if (read == null) return false;
  const r = normalize(read);
  return r !== "" && r === normalize(expected);
}
