// One-time link tokens. The plain token appears once, in the link given to the patient;
// only its SHA-256 hash is stored (test_requests.token_hash).
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { appendAuditEvent } from "@/lib/audit/append";

import { ALLOW_UPLOAD_WITHOUT_START, linkState } from "./session";

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

// ---------------------------------------------------------------------------
// Interface the capture page and submission pipeline were built against
// (labib/p0-integrated). Same names, signatures and failure values; the semantics
// follow the session model in session.ts, where used_at means "session started".
// ---------------------------------------------------------------------------

export type TokenFailure = "not_found" | "expired" | "already_used";

export interface TestRequestRow {
  id: string;
  patient_id: string;
  challenge_code: string;
  setting: "home" | "clinic";
  expires_at: string;
  used_at: string | null;
}

export type TokenCheck = { ok: true; request: TestRequestRow } | { ok: false; failure: TokenFailure };

/**
 * Is the link still usable? ok for "ready" (not started) and "active" (session running).
 *   unknown token                    → not_found
 *   link or session expired          → expired
 *   a photo was already submitted    → already_used
 * Whether an upload may proceed is decided by consumeRequest.
 */
export async function checkToken(db: SupabaseClient, token: string, now: Date): Promise<TokenCheck> {
  const { data, error } = await db
    .from("test_requests")
    .select("id, patient_id, challenge_code, setting, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return { ok: false, failure: "not_found" };
  const request = data as TestRequestRow;

  const { data: submission, error: submissionError } = await db
    .from("submissions")
    .select("id")
    .eq("request_id", request.id)
    .not("photo_path", "is", null)
    .maybeSingle();
  if (submissionError) return { ok: false, failure: "not_found" };

  const state = linkState({ expires_at: request.expires_at, used_at: request.used_at, submitted: !!submission }, now);
  if (state === "submitted") return { ok: false, failure: "already_used" };
  if (state === "link_expired" || state === "session_expired") return { ok: false, failure: "expired" };

  return { ok: true, request: { ...request, challenge_code: request.challenge_code.trim() } };
}

/**
 * Claim the link for one upload. True only when no submission exists yet for this
 * request and the session is active, or (lenient mode) not yet started, in which case
 * the session starts now. The unique submissions.request_id is the final guard against
 * two simultaneous uploads.
 */
export async function consumeRequest(db: SupabaseClient, requestId: string, now: Date): Promise<boolean> {
  const { data: request, error } = await db
    .from("test_requests")
    .select("id, expires_at, used_at")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request) return false;

  const { data: existing, error: existingError } = await db
    .from("submissions")
    .select("id")
    .eq("request_id", requestId)
    .maybeSingle();
  if (existingError || existing) return false;

  const row = request as { expires_at: string; used_at: string | null };
  const state = linkState({ expires_at: row.expires_at, used_at: row.used_at, submitted: false }, now);
  if (state === "active") return true;
  if (state !== "ready" || !ALLOW_UPLOAD_WITHOUT_START) return false;

  const { data: claimed, error: claimError } = await db
    .from("test_requests")
    .update({ used_at: now.toISOString() })
    .eq("id", requestId)
    .is("used_at", null)
    .select("id");
  if (claimError || !claimed || claimed.length === 0) return false;

  try {
    await appendAuditEvent({ actor: "system", action: "session.started", refId: requestId, payload: { via: "upload" } });
  } catch (err) {
    console.error("[token] AUDIT EVENT NOT WRITTEN for session.started", {
      requestId,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }
  return true;
}
