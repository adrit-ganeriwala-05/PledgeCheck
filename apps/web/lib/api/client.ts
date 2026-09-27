// The one place the browser talks to the backend. Each function calls the real endpoint (or the
// mock adapter, per lib/api/mode.ts), parses the body and returns a typed result, so screens
// handle every error case explicitly and never call fetch themselves.
//
// Nothing here logs. Tokens, links, challenge codes and email addresses pass through
// arguments and return values only; error results carry codes, never those values.

import type { AnchorResponse, VerifyResponse } from "@/components/audit/types";
import type { QueueCard } from "@/lib/clinic/queue";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

import type {
  AnchorError,
  ApiError,
  ApiResult,
  ApproveError,
  ApproveResponse,
  ClinicsResponse,
  CommonError,
  CycleError,
  CycleResponse,
  DeclineError,
  DeclineResponse,
  EnrollError,
  EnrollResponse,
  HomeRefusal,
  HomeTestingError,
  HomeTestingResponse,
  IssueLinkError,
  IssueLinkRequest,
  IssueLinkResponse,
  PickupError,
  PickupResponse,
  QueueResponse,
  RefillCreateError,
  RefillCreateResponse,
  RefillListFilter,
  RefillRequest,
  ReviewDecision,
  ReviewError,
  ReviewResponse,
  SignInError,
  PasswordResetError,
  SignUpError,
  SignUpResponse,
  StartError,
  StartResponse,
  SubmitPhotoError,
  SubmitPhotoResponse,
  VerifyError,
} from "./contracts";
import { isMocked, type Endpoint } from "./mode";
import { readPatientCycle, readRefillRequests } from "./server-reads";

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

type Raw = { status: number; body: unknown };

async function http(url: string, init?: RequestInit): Promise<Raw | null> {
  try {
    const res = init === undefined ? await fetch(url) : await fetch(url, init);
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return null;
  }
}

function jsonInit(method: string, payload?: unknown): RequestInit {
  return payload === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function field(body: unknown, key: string): unknown {
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

function str(body: unknown, key: string): string | undefined {
  const value = field(body, key);
  return typeof value === "string" ? value : undefined;
}

function commonError(status: number, code: string | undefined): CommonError {
  if (status === 0) return "network_error";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "not_a_clinician";
  // A 404 with no JSON error is a route that doesn't exist yet.
  if (status === 404 && code === undefined) return "not_available";
  if (status === 429) return "rate_limited";
  return "server_error";
}

function failure<E extends string>(status: number, code: string | undefined, known: readonly E[]): { ok: false; error: ApiError<E> } {
  if (code !== undefined && (known as readonly string[]).includes(code)) {
    return { ok: false, error: { code: code as E, status } };
  }
  return { ok: false, error: { code: commonError(status, code), status } };
}

function fail<E extends string>(raw: Raw | null, known: readonly E[], codeKey = "error"): { ok: false; error: ApiError<E> } {
  if (!raw) return { ok: false, error: { code: "network_error", status: 0 } };
  return failure(raw.status, str(raw.body, codeKey), known);
}

function success<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/** A 2xx whose body isn't the promised shape counts as a server error. */
function malformed(raw: Raw): { ok: false; error: ApiError<never> } {
  return { ok: false, error: { code: "server_error", status: raw.status } };
}

async function mocks() {
  return import("./mocks");
}

async function viaMock<T>(endpoint: Endpoint, run: (m: Awaited<ReturnType<typeof mocks>>) => Promise<T>): Promise<T | undefined> {
  if (!isMocked(endpoint)) return undefined;
  return run(await mocks());
}

// ---------------------------------------------------------------------------
// Patient auth (Supabase)
// ---------------------------------------------------------------------------

const SUPABASE_SIGNUP_ERRORS: Record<string, SignUpError> = {
  user_already_exists: "email_taken",
  email_exists: "email_taken",
  weak_password: "weak_password",
  email_address_invalid: "invalid_email",
  validation_failed: "invalid_email",
  over_email_send_rate_limit: "too_many_attempts",
  over_request_rate_limit: "too_many_attempts",
};

/** Supabase reports an unreachable auth server as a returned AuthRetryableFetchError, not a throw. */
function unreachable(error: { name?: string; status?: number } | null): boolean {
  return !!error && (error.name === "AuthRetryableFetchError" || error.status === 0);
}

export async function patientSignUp(email: string, password: string): Promise<ApiResult<SignUpResponse, SignUpError>> {
  const mocked = await viaMock("auth", (m) => m.patientSignUp(email, password));
  if (mocked) return mocked;
  try {
    const { data, error } = await createSupabaseClient().auth.signUp({
      email,
      password,
      // /portal/confirm, not /portal: Supabase returns the session in the URL *fragment*,
      // and a fragment does not survive an HTTP redirect. That page is a client component
      // whose whole job is to pick the session up on this origin before going anywhere.
      options: { emailRedirectTo: `${window.location.origin}/portal/confirm` },
    });
    if (unreachable(error)) return { ok: false, error: { code: "network_error", status: 0 } };
    if (error) {
      const code = SUPABASE_SIGNUP_ERRORS[error.code ?? ""];
      if (code) return { ok: false, error: { code, status: error.status ?? 400 } };
      return { ok: false, error: { code: error.status === 429 ? "too_many_attempts" : "server_error", status: error.status ?? 500 } };
    }
    // With confirmation on, Supabase hides an existing address by returning a user with no identities.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { ok: false, error: { code: "email_taken", status: 400 } };
    }
    return success({ needsEmailConfirmation: data.session === null });
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

export async function patientSignIn(email: string, password: string): Promise<ApiResult<null, SignInError>> {
  const mocked = await viaMock("auth", (m) => m.patientSignIn(email, password));
  if (mocked) return mocked;
  try {
    const { error } = await createSupabaseClient().auth.signInWithPassword({ email, password });
    if (unreachable(error)) return { ok: false, error: { code: "network_error", status: 0 } };
    // One message for every credential failure, as on the clinician form.
    if (error) return { ok: false, error: { code: "bad_credentials", status: error.status ?? 400 } };
    return success(null);
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

/**
 * Sends Supabase's password-reset email. The answer never says whether the address has an account:
 * Supabase itself doesn't reveal it, and any refusal (rate limit, unknown address) is reported as sent.
 * Only a network failure comes back as an error, so the patient can retry.
 */
export async function requestPasswordReset(email: string): Promise<ApiResult<null, PasswordResetError>> {
  const mocked = await viaMock("auth", (m) => m.requestPasswordReset(email));
  if (mocked) return mocked;
  try {
    const { error } = await createSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/portal` });
    if (unreachable(error)) return { ok: false, error: { code: "network_error", status: 0 } };
    return success(null);
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

/** Clinic staff sign-in. One generic failure for every credential problem, as for patients. */
export async function clinicianSignIn(email: string, password: string): Promise<ApiResult<null, SignInError>> {
  const mocked = await viaMock("auth", (m) => m.clinicianSignIn(email, password));
  if (mocked) return mocked;
  try {
    const { error } = await createSupabaseClient().auth.signInWithPassword({ email, password });
    if (unreachable(error)) return { ok: false, error: { code: "network_error", status: 0 } };
    if (error) return { ok: false, error: { code: "bad_credentials", status: error.status ?? 400 } };
    return success(null);
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

export async function patientSignOut(): Promise<ApiResult<null>> {
  const mocked = await viaMock("auth", (m) => m.patientSignOut());
  if (mocked) return mocked;
  try {
    await createSupabaseClient().auth.signOut();
    return success(null);
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Patient portal (needed from backend)
// ---------------------------------------------------------------------------

/** The clinics a patient can join. Public: there is no session yet when they choose. */
export async function listClinics(): Promise<ApiResult<ClinicsResponse>> {
  const mocked = await viaMock("clinics", (m) => m.listClinics());
  if (mocked) return mocked;
  const raw = await http("/api/portal/clinics", { cache: "no-store" });
  if (raw && raw.status === 200) {
    const clinics = field(raw.body, "clinics");
    return Array.isArray(clinics) ? success({ clinics: clinics as ClinicsResponse["clinics"] }) : malformed(raw);
  }
  return fail(raw, [] as const);
}

/** Joins the signed-in login to a patient record at the chosen practice. */
export async function enrollPatient(practiceId: string): Promise<ApiResult<EnrollResponse, EnrollError>> {
  const mocked = await viaMock("patientEnroll", (m) => m.enrollPatient(practiceId));
  if (mocked) return mocked;
  const raw = await http("/api/portal/enroll", jsonInit("POST", { practiceId }));
  if (raw && raw.status >= 200 && raw.status < 300) {
    const patientId = str(raw.body, "id");
    const pseudonym = str(raw.body, "pseudonym");
    return patientId && pseudonym ? success({ patientId, pseudonym }) : malformed(raw);
  }
  return fail(raw, ["already_enrolled", "unknown_practice", "invalid_request"] as const);
}

/** Read through a server action: the cycle has no HTTP route (see lib/api/server-reads.ts). */
export async function getPatientCycle(): Promise<ApiResult<CycleResponse, CycleError>> {
  const mocked = await viaMock("patientCycle", (m) => m.getPatientCycle());
  if (mocked) return mocked;
  try {
    return await readPatientCycle();
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

export async function requestRefill(): Promise<ApiResult<RefillCreateResponse, RefillCreateError>> {
  const mocked = await viaMock("refillCreate", (m) => m.requestRefill());
  if (mocked) return mocked;
  const raw = await http("/api/portal/refills", jsonInit("POST"));
  if (raw && raw.status >= 200 && raw.status < 300) {
    const requestId = str(raw.body, "id");
    const createdAt = str(raw.body, "createdAt");
    return requestId && createdAt ? success({ requestId, createdAt }) : malformed(raw);
  }
  return fail(raw, ["already_pending", "clinic_visit_required", "not_enrolled"] as const);
}

// ---------------------------------------------------------------------------
// Clinic: refill requests and enrollment (needed from backend)
// ---------------------------------------------------------------------------

/** Read through a server action: the inbox has no HTTP route (see lib/api/server-reads.ts). */
export async function listRefillRequests(_filter: RefillListFilter): Promise<ApiResult<RefillRequest[]>> {
  const mocked = await viaMock("refillList", (m) => m.listRefillRequests(_filter));
  if (mocked) return mocked;
  try {
    return await readRefillRequests();
  } catch {
    return { ok: false, error: { code: "network_error", status: 0 } };
  }
}

/**
 * Approve: one decision route serves both answers.
 *
 * The route reports `emailed`, not an email status, and answers false both when sending
 * failed and when the patient has no address at all. `hasEmail` from the card is what
 * tells those apart, so the badge says "Email off" rather than accusing the mailer.
 */
export async function approveRefillRequest(id: string, hasEmail: boolean): Promise<ApiResult<ApproveResponse, ApproveError>> {
  const mocked = await viaMock("refillApprove", (m) => m.approveRefillRequest(id));
  if (mocked) return mocked;
  const raw = await http(`/api/refills/${encodeURIComponent(id)}/decision`, jsonInit("POST", { decision: "approve", setting: "home" }));
  if (raw && raw.status === 200) {
    if (field(raw.body, "decision") !== "linked") return malformed(raw);
    const emailed = field(raw.body, "emailed") === true;
    return success({ emailStatus: emailed ? "sent" : hasEmail ? "failed" : "disabled" });
  }
  return fail(raw, ["already_decided", "not_found", "home_testing_not_allowed", "issue_failed"] as const);
}

export async function declineRefillRequest(id: string, reason: string): Promise<ApiResult<DeclineResponse, DeclineError>> {
  const mocked = await viaMock("refillDecline", (m) => m.declineRefillRequest(id, reason));
  if (mocked) return mocked;
  const raw = await http(`/api/refills/${encodeURIComponent(id)}/decision`, jsonInit("POST", { decision: "decline", reason }));
  if (raw && raw.status === 200) return success({ ok: true });
  return fail(raw, ["already_decided", "not_found", "invalid_request"] as const);
}

// ---------------------------------------------------------------------------
// Existing endpoints
// ---------------------------------------------------------------------------

export async function issueTestLink(
  request: IssueLinkRequest,
): Promise<ApiResult<IssueLinkResponse, IssueLinkError> & { refusal?: HomeRefusal }> {
  const mocked = await viaMock("issueLink", (m) => m.issueTestLink(request));
  if (mocked) return mocked;
  const raw = await http("/api/requests", jsonInit("POST", request));
  if (raw && raw.status === 200) {
    const link = str(raw.body, "link");
    const expiresAt = str(raw.body, "expiresAt");
    const requestId = str(raw.body, "requestId");
    return link && expiresAt && requestId ? success({ requestId, link, expiresAt }) : malformed(raw);
  }
  const result = fail(raw, ["invalid_request", "not_found", "home_testing_not_allowed", "issue_failed", "audit_failed"] as const);
  const refusal = str(raw?.body, "reason") as HomeRefusal | undefined;
  return refusal ? { ...result, refusal } : result;
}

export async function setHomeTesting(
  patientId: string,
  allowed: boolean,
): Promise<ApiResult<HomeTestingResponse, HomeTestingError> & { changed?: boolean }> {
  const mocked = await viaMock("homeTesting", (m) => m.setHomeTesting(patientId, allowed));
  if (mocked) return mocked;
  const raw = await http(`/api/patients/${patientId}/home-testing`, jsonInit("PATCH", { allowed }));
  if (raw && raw.status === 200) {
    return success({ patientId, allowed: field(raw.body, "allowed") === true, changed: field(raw.body, "changed") === true });
  }
  const result = fail(raw, ["invalid_request", "not_found", "update_failed", "audit_failed"] as const);
  return field(raw?.body, "changed") === true ? { ...result, changed: true } : result;
}

export async function getQueue(): Promise<ApiResult<QueueResponse>> {
  const mocked = await viaMock("queue", (m) => m.getQueue());
  if (mocked) return mocked;
  const raw = await http("/api/queue", { cache: "no-store" });
  if (raw && raw.status === 200) {
    const cards = field(raw.body, "cards");
    return Array.isArray(cards) ? success({ cards: cards as QueueCard[] }) : malformed(raw);
  }
  return fail(raw, [] as const);
}

export async function submitReview(
  submissionId: string,
  decision: ReviewDecision,
  reason?: string,
): Promise<ApiResult<ReviewResponse, ReviewError> & { reviewRecorded?: boolean }> {
  const mocked = await viaMock("review", (m) => m.submitReview(submissionId, decision, reason));
  if (mocked) return mocked;
  const raw = await http("/api/reviews", jsonInit("POST", { submissionId, decision, reason }));
  if (raw && raw.status === 200) {
    const window = field(raw.body, "window") as ReviewResponse["window"] | undefined;
    return success({ status: field(raw.body, "status") as ReviewDecision, window: window ?? null });
  }
  const result = fail(raw, [
    "invalid_request",
    "prescriber_only",
    "forbidden",
    "not_found",
    "not_reviewable",
    "already_reviewed",
    "window_logic_unavailable",
    "window_logic_failed",
    "review_failed",
    "audit_failed",
    "photo_delete_failed",
  ] as const);
  return { ...result, reviewRecorded: field(raw?.body, "reviewRecorded") === true };
}

/** POST /api/windows/fill, labeled "Mark picked up" in the UI. */
export async function markPickedUp(windowId: string): Promise<ApiResult<PickupResponse, PickupError>> {
  const mocked = await viaMock("pickup", (m) => m.markPickedUp(windowId));
  if (mocked) return mocked;
  const raw = await http("/api/windows/fill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowId }),
  });
  if (!raw) return { ok: false, error: { code: "network_error", status: 0 } };
  if (raw.status === 200) {
    const days = field(raw.body, "daysToFill");
    return success({ alreadyPickedUp: field(raw.body, "alreadyFilled") === true, daysToFill: typeof days === "number" ? days : null });
  }
  // This route answers { ok: false, reason: <sentence> }, so the status carries the meaning.
  const byStatus: Partial<Record<number, PickupError>> = { 400: "invalid_request", 404: "not_found", 409: "not_open" };
  const code = byStatus[raw.status];
  return code ? { ok: false, error: { code, status: raw.status } } : failure(raw.status, undefined, [] as const);
}

const START_STATES = [
  "invalid",
  "link_expired",
  "session_expired",
  "submitted",
  "not_logged_in",
  "wrong_patient",
  "invalidated",
  "expired",
  "already_used",
] as const satisfies readonly StartError[];

export async function startTestSession(token: string): Promise<ApiResult<StartResponse, StartError>> {
  const mocked = await viaMock("testStart", (m) => m.startTestSession(token));
  if (mocked) return mocked;
  const raw = await http(`/api/t/${encodeURIComponent(token)}/start`, { method: "POST" });
  if (!raw) return { ok: false, error: { code: "network_error", status: 0 } };
  const challengeCode = str(raw.body, "challengeCode");
  const sessionEndsAt = str(raw.body, "sessionEndsAt");
  if (raw.status === 200 && field(raw.body, "ok") === true && challengeCode && sessionEndsAt) {
    return success({ challengeCode, sessionEndsAt, codeExpiresAt: str(raw.body, "codeExpiresAt") ?? null });
  }
  // Today's route answers { ok: false, state }; v3 may answer { error }. Accept either.
  const code = str(raw.body, "state") ?? str(raw.body, "error");
  if (code !== undefined && (START_STATES as readonly string[]).includes(code)) {
    return { ok: false, error: { code: code as StartError, status: raw.status } };
  }
  if (raw.status === 401) return { ok: false, error: { code: "not_logged_in", status: 401 } };
  if (raw.status === 403) return { ok: false, error: { code: "wrong_patient", status: 403 } };
  return { ok: false, error: { code: raw.status === 429 ? "rate_limited" : "server_error", status: raw.status } };
}

export async function submitTestPhoto(token: string, photo: Blob): Promise<ApiResult<SubmitPhotoResponse, SubmitPhotoError>> {
  const mocked = await viaMock("testSubmit", (m) => m.submitTestPhoto(token, photo));
  if (mocked) return mocked;
  const body = new FormData();
  body.append("token", token);
  body.append("image", photo, "test.jpg");
  const raw = await http("/api/submissions", { method: "POST", body });
  if (!raw) return { ok: false, error: { code: "network_error", status: 0 } };
  const reason = str(raw.body, "reason") ?? null;
  if (raw.status === 200 && field(raw.body, "received") !== false) return success({ received: true, reason });
  // The pipeline's reason is the error code; the page turns it into patient copy.
  return { ok: false, error: { code: reason ?? "server_error", status: raw.status } };
}

export async function verifyAudit(): Promise<ApiResult<VerifyResponse, VerifyError>> {
  const mocked = await viaMock("auditVerify", (m) => m.verifyAudit());
  if (mocked) return mocked;
  const raw = await http("/api/audit/verify", { cache: "no-store" });
  if (raw && raw.status === 200 && raw.body && typeof raw.body === "object") return success(raw.body as VerifyResponse);
  if (raw && raw.status === 200) return malformed(raw);
  return fail(raw, ["verify_failed"] as const);
}

export async function anchorAuditHead(): Promise<ApiResult<AnchorResponse, AnchorError> & { explorerUrl?: string }> {
  const mocked = await viaMock("anchor", (m) => m.anchorAuditHead());
  if (mocked) return mocked;
  const raw = await http("/api/anchors", { method: "POST" });
  if (raw && raw.status === 200 && raw.body && typeof raw.body === "object") return success(raw.body as AnchorResponse);
  if (raw && raw.status === 200) return malformed(raw);
  const result = fail(raw, [
    "nothing_to_anchor",
    "solana_not_configured",
    "wallet_needs_devnet_sol",
    "solana_unavailable",
    "anchor_not_recorded",
    "anchor_failed",
  ] as const);
  const explorerUrl = str(raw?.body, "explorerUrl");
  return explorerUrl ? { ...result, explorerUrl } : result;
}
