// Fraud checks for the submission pipeline. Contract: lib/fraud/CONTRACT.md.
// Every failure should end as submissions.status = "rejected_fraud", plus one
// recordFraudRejection() call.
//
// These checks are strict: an upload needs an active session. The interim pipeline's
// checkToken / consumeRequest (token.ts) and checkReuse (reuse.ts) keep working meanwhile.
import "server-only";

import { appendAuditEvent } from "@/lib/audit/append";
import { createAdminClient } from "@/lib/supabase/admin";

import { codesMatch } from "./code";
import { findClosestPhash, REUSE_DISTANCE } from "./reuse";
import { linkState } from "./session";
import { hashToken } from "./token";

export type SessionFailure = "invalid_link" | "session_not_started" | "session_expired" | "already_submitted";

export type FraudReason = SessionFailure | "code_missing_or_wrong" | "photo_already_used";

const FRAUD_REASONS: readonly FraudReason[] = [
  "invalid_link",
  "session_not_started",
  "session_expired",
  "already_submitted",
  "code_missing_or_wrong",
  "photo_already_used",
];

export type SessionCheck =
  | { ok: true; requestId: string; patientId: string; practiceId: string; expectedCode: string }
  | { ok: false; reason: SessionFailure };

/**
 * Is this upload inside an active session? `now` exists for tests; callers omit it so the
 * server stamps the time. Never pass a client-supplied timestamp.
 */
export async function checkSessionForUpload(token: string, now: Date = new Date()): Promise<SessionCheck> {
  const admin = createAdminClient();

  const { data: request, error } = await admin
    .from("test_requests")
    .select("id, patient_id, challenge_code, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new Error("could not read test request");
  if (!request) return { ok: false, reason: "invalid_link" };

  // Any submission row, with or without a photo: one upload per link.
  const { data: existing, error: existingError } = await admin
    .from("submissions")
    .select("id")
    .eq("request_id", request.id)
    .maybeSingle();
  if (existingError) throw new Error("could not read submissions");
  if (existing) return { ok: false, reason: "already_submitted" };

  const state = linkState({ expires_at: request.expires_at, used_at: request.used_at, submitted: false }, now);
  if (state === "ready" || state === "link_expired") return { ok: false, reason: "session_not_started" };
  if (state === "session_expired") return { ok: false, reason: "session_expired" };

  const { data: patient, error: patientError } = await admin
    .from("patients")
    .select("practice_id")
    .eq("id", request.patient_id)
    .maybeSingle();
  if (patientError || !patient) throw new Error("could not read patient for request");

  return {
    ok: true,
    requestId: request.id,
    patientId: request.patient_id,
    practiceId: patient.practice_id,
    expectedCode: request.challenge_code.trim(),
  };
}

export function checkChallengeCode(
  expected: string,
  codeRead: string | null,
): { ok: true } | { ok: false; reason: "code_missing_or_wrong" } {
  return codesMatch(expected, codeRead) ? { ok: true } : { ok: false, reason: "code_missing_or_wrong" };
}

/** Throws PhashFormatError on a malformed hash; a match is distance < REUSE_DISTANCE. */
export async function checkPhotoReuse(
  phash: string,
  opts: { excludeSubmissionId?: string } = {},
): Promise<{ ok: true } | { ok: false; reason: "photo_already_used"; matchedSubmissionId: string; distance: number }> {
  const best = await findClosestPhash(createAdminClient(), phash, opts.excludeSubmissionId);
  if (!best || best.distance >= REUSE_DISTANCE) return { ok: true };
  return { ok: false, reason: "photo_already_used", matchedSubmissionId: best.submissionId, distance: best.distance };
}

/**
 * Audit a fraud rejection. The payload is { reason } only: never the phash, code or token.
 * Best effort: logs and returns null on failure so the rejection itself still stands.
 */
export async function recordFraudRejection(
  requestId: string,
  reason: FraudReason,
): Promise<{ seq: number; hash: string } | null> {
  if (!FRAUD_REASONS.includes(reason)) throw new Error("unknown fraud reason");
  try {
    return await appendAuditEvent({
      actor: "system",
      action: "submission.rejected_fraud",
      refId: requestId,
      payload: { reason },
    });
  } catch (err) {
    console.error("[fraud] AUDIT EVENT NOT WRITTEN for submission.rejected_fraud", {
      requestId,
      reason,
      cause: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}
