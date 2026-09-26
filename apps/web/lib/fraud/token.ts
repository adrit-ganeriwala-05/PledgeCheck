// One-time link tokens: hashing and validation.
//
// Owner: Nihalika (ticket N1). Written by Labib at 4 AM so the submission
// pipeline (L4) could be finished end to end before N1 landed. Replace freely;
// the pipeline only needs `hashToken` and `consumeRequest` to keep their shape.

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Tokens are stored only as a SHA-256 hash; the plain token is shown once. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The 4-character code the patient writes on the test. No lookalike glyphs. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newChallengeCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export type TokenFailure = "not_found" | "expired" | "already_used";

export interface TestRequestRow {
  id: string;
  patient_id: string;
  challenge_code: string;
  setting: "home" | "clinic";
  expires_at: string;
  used_at: string | null;
}

export type TokenCheck =
  | { ok: true; request: TestRequestRow }
  | { ok: false; failure: TokenFailure };

/** Look the token up and reject a reused, expired or unknown one. */
export async function checkToken(
  db: SupabaseClient,
  token: string,
  now: Date,
): Promise<TokenCheck> {
  const { data, error } = await db
    .from("test_requests")
    .select("id, patient_id, challenge_code, setting, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) return { ok: false, failure: "not_found" };

  const request = data as TestRequestRow;
  if (request.used_at) return { ok: false, failure: "already_used" };
  if (new Date(request.expires_at).getTime() <= now.getTime()) {
    return { ok: false, failure: "expired" };
  }

  return { ok: true, request };
}

/**
 * Mark the link used. Conditional on used_at still being null, so two phones
 * submitting at once cannot both win.
 */
export async function consumeRequest(
  db: SupabaseClient,
  requestId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from("test_requests")
    .update({ used_at: now.toISOString() })
    .eq("id", requestId)
    .is("used_at", null)
    .select("id");

  return !error && (data?.length ?? 0) > 0;
}
