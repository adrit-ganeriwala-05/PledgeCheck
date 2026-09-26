// Link and session states. No schema change: test_requests.used_at records when the
// patient tapped Start ("link consumed: session started"), and the session ends
// SESSION_MINUTES later.
//
//   ready            not started, now < expires_at
//   active           started, now < used_at + SESSION_MINUTES
//   session_expired  started, now >= used_at + SESSION_MINUTES
//   link_expired     not started, now >= expires_at
//   submitted        a submission with a photo already exists (checked first)
//
// The challenge code is stored when the link is issued but leaves the server only while
// the session is active, so a photo taken before Start cannot contain it.
import "server-only";

import { appendAuditEvent } from "@/lib/audit/append";
import { createAdminClient } from "@/lib/supabase/admin";

import { hashToken } from "./token";

export const SESSION_MINUTES = 40;
export const LINK_TTL_HOURS = 24;

/**
 * Lenient mode for the older checkToken / consumeRequest (token.ts): when true, an upload
 * on a never-started link starts the session at upload time. Off: the capture page calls
 * POST /api/t/:token/start, and every upload needs an active session.
 */
export const ALLOW_UPLOAD_WITHOUT_START = false;

export type LinkState = "ready" | "active" | "session_expired" | "link_expired" | "submitted";

export type LinkStateInput = {
  expires_at: string | Date;
  used_at: string | Date | null;
  /** True when a submissions row with a photo exists for this request. */
  submitted: boolean;
};

export function linkExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + LINK_TTL_HOURS * 60 * 60 * 1000);
}

export function sessionEndsAt(request: Pick<LinkStateInput, "used_at">): Date | null {
  if (request.used_at == null) return null;
  return new Date(new Date(request.used_at).getTime() + SESSION_MINUTES * 60 * 1000);
}

export function linkState(request: LinkStateInput, now: Date): LinkState {
  if (request.submitted) return "submitted";
  const endsAt = sessionEndsAt(request);
  if (endsAt) return now.getTime() < endsAt.getTime() ? "active" : "session_expired";
  return now.getTime() < new Date(request.expires_at).getTime() ? "ready" : "link_expired";
}

// ---------------------------------------------------------------------------
// Database lookups (service role: the patient has no account)
// ---------------------------------------------------------------------------

export type LinkRecord = {
  requestId: string;
  patientId: string;
  challengeCode: string;
  setting: "home" | "clinic";
  expiresAt: string;
  usedAt: string | null;
  submitted: boolean;
  language: "en" | "es";
};

type Admin = ReturnType<typeof createAdminClient>;

export async function loadLinkByToken(token: string, admin: Admin = createAdminClient()): Promise<LinkRecord | null> {
  const { data: request, error } = await admin
    .from("test_requests")
    .select("id, patient_id, challenge_code, setting, expires_at, used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new Error("could not read test request");
  if (!request) return null;

  const [patient, submission] = await Promise.all([
    admin.from("patients").select("language").eq("id", request.patient_id).maybeSingle(),
    admin
      .from("submissions")
      .select("id")
      .eq("request_id", request.id)
      .not("photo_path", "is", null)
      .maybeSingle(),
  ]);
  if (patient.error || submission.error) throw new Error("could not read link details");

  return {
    requestId: request.id,
    patientId: request.patient_id,
    challengeCode: request.challenge_code.trim(),
    setting: request.setting as LinkRecord["setting"],
    expiresAt: request.expires_at,
    usedAt: request.used_at,
    submitted: !!submission.data,
    language: patient.data?.language === "es" ? "es" : "en",
  };
}

export function stateOf(link: LinkRecord, now: Date): LinkState {
  return linkState({ expires_at: link.expiresAt, used_at: link.usedAt, submitted: link.submitted }, now);
}

export type LinkStatus = {
  ok: boolean;
  state: LinkState | "invalid";
  language: "en" | "es" | null;
  sessionEndsAt: string | null;
  challengeCode: string | null;
};

/** What the patient's phone may see. Never includes patient, practice or request ids. */
export async function getLinkStatus(token: string, now: Date): Promise<LinkStatus> {
  const link = await loadLinkByToken(token);
  if (!link) return { ok: false, state: "invalid", language: null, sessionEndsAt: null, challengeCode: null };
  const state = stateOf(link, now);
  return {
    ok: state === "ready" || state === "active",
    state,
    language: link.language,
    sessionEndsAt: sessionEndsAt({ used_at: link.usedAt })?.toISOString() ?? null,
    challengeCode: state === "active" ? link.challengeCode : null,
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export type StartResult =
  | { ok: true; state: "active"; sessionEndsAt: string; challengeCode: string }
  | { ok: false; state: Exclude<LinkState, "active"> | "invalid" };

function active(link: LinkRecord): StartResult {
  return {
    ok: true,
    state: "active",
    sessionEndsAt: sessionEndsAt({ used_at: link.usedAt })!.toISOString(),
    challengeCode: link.challengeCode,
  };
}

/**
 * Begin the patient's session and reveal the code. Idempotent: reopening the link
 * mid-session returns the same deadline and code. A future ID-verification step
 * belongs at the top of this function, before used_at is set.
 */
export async function startSession(token: string, now: Date): Promise<StartResult> {
  const admin = createAdminClient();
  const link = await loadLinkByToken(token, admin);
  if (!link) return { ok: false, state: "invalid" };

  const state = stateOf(link, now);
  if (state === "active") return active(link);
  if (state !== "ready") return { ok: false, state };

  // Conditional on used_at still being null, so a double tap or two phones cannot both
  // start (and audit) a session.
  const startedAt = now.toISOString();
  const { data: claimed, error } = await admin
    .from("test_requests")
    .update({ used_at: startedAt })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .select("id");
  if (error) throw new Error("could not start session");

  if (!claimed || claimed.length === 0) {
    // Lost a race: someone else started it. Report whatever the link is now.
    const current = await loadLinkByToken(token, admin);
    if (!current) return { ok: false, state: "invalid" };
    const currentState = stateOf(current, now);
    return currentState === "active" ? active(current) : { ok: false, state: currentState };
  }

  try {
    await appendAuditEvent({ actor: "system", action: "session.started", refId: link.requestId, payload: {} });
  } catch (err) {
    // The session has started; an audit failure must not block the patient.
    console.error("[session] AUDIT EVENT NOT WRITTEN for session.started", {
      requestId: link.requestId,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }

  return active({ ...link, usedAt: startedAt });
}
