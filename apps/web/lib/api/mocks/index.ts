// Mock adapter: same signatures and result shapes as lib/api/client.ts, backed by ./store.
// Loaded only when lib/api/mode says an endpoint is mocked, which never happens in production.
//
// Every state is reachable, errors included:
//   sign up      *@taken.test → email_taken · password < 8 chars → weak_password ·
//                confirm*@… → "check your email"
//   sign in      password "wrong" → bad_credentials (patient and clinician)
//   network      *@offline.test → network_error on sign up, sign in and password reset
//   enroll       EXP… → expired_code · USED… → already_enrolled · anything but 8 letters or
//                digits → invalid_code
//   approve      PT-3310 → email failed · PT-5120 → email disabled · PT-4477 → 409 once
//   test link    /t/mock-invalidated, mock-expired, mock-already-used, mock-wrong-patient,
//                mock-link-expired, mock-submitted; any mock link while signed out → not_logged_in

import type { AnchorResponse, VerifyResponse } from "@/components/audit/types";
import type { QueueCard } from "@/lib/clinic/queue";

import type {
  AnchorError,
  ApiResult,
  ApproveError,
  ApproveResponse,
  Cycle,
  ClinicsResponse,
  CycleError,
  CycleResponse,
  CycleStatus,
  DeclineError,
  DeclineResponse,
  EmailStatus,
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
} from "../contracts";
import { ahead, DAY, DEMO_PATIENT, load, reset, stamp, update, type MockDb } from "./store";

export { reset as resetMockData };

// Mirrors POST /api/portal/refills, which refuses only while a row is still `requested`.
const OPEN_STATUSES: CycleStatus[] = ["requested"];

function delay(): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 350));
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function err<E extends string>(code: E, status: number): { ok: false; error: { code: E; status: number } } {
  return { ok: false, error: { code, status } };
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Challenge codes are never stored. A mock code is derived from the (non-secret) cycle id, so a
// patient tab and a clinic tab agree on it without either writing it down.
const SEED_CODES: Record<string, string> = {
  "mock-sub-faint": "M3X8",
  "mock-sub-clean": "R9TD",
  "mock-sub-unknown": "Q4LA",
};

export function mockCodeFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.floor(hash / CODE_ALPHABET.length) ^ (hash << 7);
    hash >>>= 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Patient auth
// ---------------------------------------------------------------------------

export async function patientSignUp(email: string, password: string): Promise<ApiResult<SignUpResponse, SignUpError>> {
  await delay();
  const address = email.trim().toLowerCase();
  if (address.endsWith("@offline.test")) return err("network_error", 0);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return err("invalid_email", 400);
  if (address.endsWith("@taken.test")) return err("email_taken", 400);
  if (password.length < 8) return err("weak_password", 422);
  if (address.startsWith("confirm")) return ok({ needsEmailConfirmation: true });
  update((db) => {
    db.patientSignedIn = true;
    db.patientEnrolled = false;
  });
  return ok({ needsEmailConfirmation: false });
}

export async function patientSignIn(email: string, password: string): Promise<ApiResult<null, SignInError>> {
  countSignIn();
  await delay();
  if (email.trim().toLowerCase().endsWith("@offline.test")) return err("network_error", 0);
  if (!email.trim() || password === "wrong") return err("bad_credentials", 400);
  update((db) => {
    db.patientSignedIn = true;
  });
  return ok(null);
}

function countSignIn() {
  update((db) => {
    db.signInAttempts = (db.signInAttempts ?? 0) + 1;
  });
}

/** Clinic sign-in, offline demo: the same fixtures as the patient sign-in. The role comes from the mock
 *  badge's role switch (the pc-mock-role cookie), as elsewhere in mock mode. */
export async function clinicianSignIn(email: string, password: string): Promise<ApiResult<null, SignInError>> {
  countSignIn();
  await delay();
  if (email.trim().toLowerCase().endsWith("@offline.test")) return err("network_error", 0);
  if (!email.trim() || password === "wrong") return err("bad_credentials", 400);
  return ok(null);
}

export async function requestPasswordReset(email: string): Promise<ApiResult<null, PasswordResetError>> {
  await delay();
  if (email.trim().toLowerCase().endsWith("@offline.test")) return err("network_error", 0);
  // Same answer for every other address: the screen never learns whether an account exists.
  return ok(null);
}

export async function patientSignOut(): Promise<ApiResult<null>> {
  await delay();
  update((db) => {
    db.patientSignedIn = false;
  });
  return ok(null);
}

// ---------------------------------------------------------------------------
// Patient portal
// ---------------------------------------------------------------------------

/** The public clinic list the signup form offers. */
export async function listClinics(): Promise<ApiResult<ClinicsResponse>> {
  await delay();
  return ok({
    clinics: [
      { id: "mock-practice-1", name: "Peachtree Dermatology", prescribers: ["Dr. A. Rivera", "Dr. S. Okafor"] },
      { id: "mock-practice-2", name: "Midtown Skin Clinic", prescribers: ["Dr. L. Chen"] },
    ],
  });
}

export async function enrollPatient(practiceId: string): Promise<ApiResult<EnrollResponse, EnrollError>> {
  await delay();
  const db = load();
  if (!db.patientSignedIn) return err("unauthenticated", 401);
  if (db.patientEnrolled) return err("already_enrolled", 409);
  if (!practiceId.startsWith("mock-practice-")) return err("unknown_practice", 404);
  update((d) => {
    d.patientEnrolled = true;
  });
  return ok({ patientId: DEMO_PATIENT.id, pseudonym: DEMO_PATIENT.pseudonym });
}

function guardPatient(db: MockDb): { ok: false; error: { code: "unauthenticated" | "not_enrolled"; status: number } } | null {
  if (!db.patientSignedIn) return err("unauthenticated", 401);
  if (!db.patientEnrolled) return err("not_enrolled", 403);
  return null;
}

export async function getPatientCycle(): Promise<ApiResult<CycleResponse, CycleError>> {
  await delay();
  const db = load();
  const blocked = guardPatient(db);
  if (blocked) return blocked;
  return ok({ cycle: db.cycle });
}

export async function requestRefill(): Promise<ApiResult<RefillCreateResponse, RefillCreateError>> {
  await delay();
  const db = load();
  const blocked = guardPatient(db);
  if (blocked) return blocked;
  if (db.cycle && OPEN_STATUSES.includes(db.cycle.status)) return err("already_pending", 409);
  const requestId = randomId("mock-req");
  const createdAt = new Date().toISOString();
  update((d) => {
    const now = createdAt;
    d.cycle = {
      id: requestId,
      status: "requested",
      timestamps: { requested: now },
      emailStatus: null,
      pickupDeadline: null,
      declineReason: null,
      rejectReason: null,
      canRequestAgain: false,
      clinicVisitRequired: false,
    };
    d.cycleSubmissionId = null;
    d.cycleWindowId = null;
    d.requests = d.requests.filter((r) => r.patientId !== DEMO_PATIENT.id || r.status !== "requested");
    d.requests.unshift({
      id: requestId,
      patientId: DEMO_PATIENT.id,
      pseudonym: DEMO_PATIENT.pseudonym,
      status: "requested",
      requestedAt: now,
      hasEmail: true,
      declineReason: null,
    });
  });
  return ok({ requestId, createdAt });
}

// ---------------------------------------------------------------------------
// Clinic: refill requests and enrollment
// ---------------------------------------------------------------------------

export async function listRefillRequests(filter: RefillListFilter): Promise<ApiResult<RefillRequest[]>> {
  await delay();
  const db = load();
  return ok(
    db.requests
      .filter((r) => r.status === filter.status)
      .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt)),
  );
}

/** The real route reports `emailed`; a patient with no address on file gets "disabled". */
function emailOutcomeFor(request: RefillRequest): EmailStatus {
  if (!request.hasEmail) return "disabled";
  return request.pseudonym === "PT-3310" ? "failed" : "sent";
}

function syncCycleOnApprove(db: MockDb, request: RefillRequest, emailStatus: EmailStatus) {
  if (request.patientId !== DEMO_PATIENT.id || !db.cycle || db.cycle.id !== request.id) return;
  db.cycle = { ...stamp(db.cycle, "approved"), emailStatus };
}

export async function approveRefillRequest(id: string): Promise<ApiResult<ApproveResponse, ApproveError>> {
  await delay();
  return update((db) => {
    const request = db.requests.find((r) => r.id === id);
    if (!request) return err("not_found", 404);
    if (db.raceOnce.includes(request.pseudonym)) {
      // Someone else decided it a moment ago.
      db.raceOnce = db.raceOnce.filter((p) => p !== request.pseudonym);
      request.status = "linked";
      return err("already_decided", 409);
    }
    if (request.status !== "requested") return err("already_decided", 409);
    const emailStatus = emailOutcomeFor(request);
    request.status = "linked";
    syncCycleOnApprove(db, request, emailStatus);
    return ok({ emailStatus });
  });
}

export async function declineRefillRequest(id: string, reason: string): Promise<ApiResult<DeclineResponse, DeclineError>> {
  await delay();
  if (!reason.trim()) return err("invalid_request", 400);
  return update((db) => {
    const request = db.requests.find((r) => r.id === id);
    if (!request) return err("not_found", 404);
    if (request.status !== "requested") return err("already_decided", 409);
    request.status = "declined";
    request.declineReason = reason.trim();
    if (request.patientId === DEMO_PATIENT.id && db.cycle?.id === id) {
      db.cycle = { ...stamp(db.cycle, "declined"), declineReason: reason.trim(), canRequestAgain: true };
    }
    return ok({ ok: true as const });
  });
}

// ---------------------------------------------------------------------------
// Screens that read Supabase on the server (offline demo only)
// ---------------------------------------------------------------------------

export function mockPatients() {
  return load().patients;
}

export function mockWindows() {
  return load().windows;
}

// ---------------------------------------------------------------------------
// Existing endpoints (offline demo: NEXT_PUBLIC_API_MOCKS=all)
// ---------------------------------------------------------------------------

export async function issueTestLink(
  request: IssueLinkRequest,
): Promise<ApiResult<IssueLinkResponse, IssueLinkError> & { refusal?: HomeRefusal }> {
  await delay();
  const patient = load().patients.find((p) => p.id === request.patientId);
  if (!patient) return err("not_found", 404);
  if (request.setting === "home") {
    const refusal: HomeRefusal | null = !patient.canGetPregnant
      ? "cannot_get_pregnant"
      : patient.phase === "pre"
        ? "pre_treatment"
        : !patient.homeTestingAllowed
          ? "not_permitted"
          : null;
    if (refusal) return { ...err("home_testing_not_allowed", 409), refusal };
  }
  return ok({
    requestId: randomId("mock-tr"),
    link: `${window.location.origin}/t/${randomId("mock")}`,
    expiresAt: ahead(DAY),
  });
}

export async function setHomeTesting(patientId: string, allowed: boolean): Promise<ApiResult<HomeTestingResponse, HomeTestingError>> {
  await delay();
  return update((db) => {
    const patient = db.patients.find((p) => p.id === patientId);
    if (!patient) return err("not_found", 404);
    const changed = patient.homeTestingAllowed !== allowed;
    patient.homeTestingAllowed = allowed;
    return ok({ patientId, allowed, changed });
  });
}

export async function getQueue(): Promise<ApiResult<QueueResponse>> {
  await delay();
  const db = load();
  const cards: QueueCard[] = db.queue.map((c) => ({
    ...c,
    grok: {
      ...c.grok,
      code:
        SEED_CODES[c.submissionId] ??
        (c.submissionId === db.cycleSubmissionId && db.cycle ? mockCodeFor(db.cycle.id) : c.grok.code),
    },
  }));
  return ok({ cards });
}

export async function submitReview(
  submissionId: string,
  decision: ReviewDecision,
  reason?: string,
): Promise<ApiResult<ReviewResponse, ReviewError> & { reviewRecorded?: boolean }> {
  await delay();
  if (decision === "rejected" && !reason?.trim()) return err("invalid_request", 400);
  return update((db) => {
    const card = db.queue.find((c) => c.submissionId === submissionId);
    if (!card) return err("not_found", 404);
    db.queue = db.queue.filter((c) => c.submissionId !== submissionId);
    const isDemo = db.cycleSubmissionId === submissionId && db.cycle;
    if (decision === "rejected") {
      if (isDemo && db.cycle) {
        db.cycle = { ...stamp(db.cycle, "rejected"), rejectReason: reason!.trim() };
      }
      return ok({ status: "rejected" as const, window: null });
    }
    const opensAt = new Date().toISOString();
    const closesAt = ahead(7 * DAY);
    const windowId = randomId("mock-window");
    db.windows.push({
      id: windowId,
      patientId: isDemo ? DEMO_PATIENT.id : randomId("mock-patient"),
      pseudonym: card.patient.pseudonym,
      isFirstRx: false,
      opensAt,
      closesAt,
      filledAt: null,
      status: "open",
    });
    if (isDemo && db.cycle) {
      db.cycle = { ...stamp(db.cycle, "window_open"), pickupDeadline: closesAt };
      db.cycleWindowId = windowId;
    }
    return ok({ status: "approved" as const, window: { opensAt, closesAt } });
  });
}

export async function markPickedUp(windowId: string): Promise<ApiResult<PickupResponse, PickupError>> {
  await delay();
  return update((db) => {
    const row = db.windows.find((w) => w.id === windowId);
    if (!row) return err("not_found", 404);
    if (row.status === "filled") return ok({ alreadyPickedUp: true, daysToFill: null });
    if (row.status !== "open" || Date.parse(row.closesAt) <= Date.now()) return err("not_open", 409);
    row.status = "filled";
    row.filledAt = new Date().toISOString();
    if (db.cycleWindowId === windowId && db.cycle) db.cycle = stamp(db.cycle, "picked_up");
    return ok({ alreadyPickedUp: false, daysToFill: Math.floor((Date.now() - Date.parse(row.opensAt)) / DAY) });
  });
}

const START_FIXTURES: Record<string, StartError> = {
  "mock-invalidated": "invalidated",
  "mock-expired": "expired",
  "mock-already-used": "already_used",
  "mock-wrong-patient": "wrong_patient",
  "mock-link-expired": "link_expired",
  "mock-submitted": "submitted",
};

const START_STATUS: Record<StartError, number> = {
  invalid: 404,
  link_expired: 409,
  session_expired: 409,
  submitted: 409,
  not_logged_in: 401,
  wrong_patient: 403,
  invalidated: 410,
  expired: 410,
  already_used: 410,
};

export async function startTestSession(token: string): Promise<ApiResult<StartResponse, StartError>> {
  await delay();
  if (!token.startsWith("mock-")) return err("invalid", 404);
  if (!load().patientSignedIn) return err("not_logged_in", 401);
  const fixture = START_FIXTURES[token];
  if (fixture) return err(fixture, START_STATUS[fixture]);
  const now = Date.now();
  return ok({
    challengeCode: mockCodeFor(load().cycle?.id ?? token),
    sessionEndsAt: new Date(now + 40 * 60 * 1000).toISOString(),
    codeExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  });
}

export async function submitTestPhoto(token: string, photo: Blob): Promise<ApiResult<SubmitPhotoResponse, SubmitPhotoError>> {
  await delay();
  void photo;
  if (!token.startsWith("mock-")) return err("invalid_link", 410);
  const submissionId = randomId("mock-sub");
  update((db) => {
    db.queue.push({
      submissionId,
      status: "ready_for_review",
      capturedAt: new Date().toISOString(),
      patient: { pseudonym: DEMO_PATIENT.pseudonym, phase: "during", language: "en" },
      photoUrl: null,
      grok: { result: "negative", code: null, confidence: 0.94, codeMatches: true, controlLine: true, testLine: "none" },
      opencv: { result: "negative", confidence: 0.91 },
      readersAgree: true,
      flags: [],
      window: null,
      canReview: true,
    });
    if (db.cycle && ["approved", "rejected"].includes(db.cycle.status)) {
      db.cycle = { ...stamp(stamp(db.cycle, "submitted"), "in_review") };
      db.cycleSubmissionId = submissionId;
    }
  });
  return ok({ received: true, reason: null });
}

export async function verifyAudit(): Promise<ApiResult<VerifyResponse, VerifyError>> {
  await delay();
  return err("verify_failed", 500);
}

export async function anchorAuditHead(): Promise<ApiResult<AnchorResponse, AnchorError>> {
  await delay();
  return err("solana_not_configured", 500);
}

// ---------------------------------------------------------------------------
// Scenario control (the Mock data badge)
// ---------------------------------------------------------------------------

export const SCENARIOS = ["none", ...(["requested", "approved", "approved_failed", "submitted", "in_review", "window_open", "picked_up", "declined", "rejected", "rejected_new_link", "missed", "signed_out", "not_enrolled"] as const)] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function setScenario(scenario: Scenario): void {
  update((db) => {
    db.patientSignedIn = scenario !== "signed_out";
    db.patientEnrolled = scenario !== "not_enrolled";
    db.cycle = scenarioCycle(scenario);
    db.cycleSubmissionId = null;
    db.cycleWindowId = null;
  });
}

function scenarioCycle(scenario: Scenario): Cycle | null {
  if (scenario === "none" || scenario === "signed_out" || scenario === "not_enrolled") return null;
  const base: Cycle = {
    id: "mock-req-demo",
    status: "requested",
    timestamps: { requested: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
    emailStatus: null,
    pickupDeadline: null,
    declineReason: null,
    rejectReason: null,
    canRequestAgain: false,
    clinicVisitRequired: false,
  };
  switch (scenario) {
    case "requested":
      return base;
    case "approved":
      return { ...stamp(base, "approved"), emailStatus: "sent" };
    case "approved_failed":
      return { ...stamp(base, "approved"), emailStatus: "failed" };
    case "submitted":
      return stamp(stamp(base, "approved"), "submitted");
    case "in_review":
      return stamp(stamp(stamp(base, "approved"), "submitted"), "in_review");
    case "window_open":
      return { ...stamp(stamp(stamp(stamp(base, "approved"), "submitted"), "in_review"), "window_open"), pickupDeadline: ahead(4 * DAY + 5 * 60 * 60 * 1000) };
    case "picked_up":
      return { ...stamp(stamp(stamp(stamp(stamp(base, "approved"), "submitted"), "in_review"), "window_open"), "picked_up"), pickupDeadline: ahead(3 * DAY) };
    case "declined":
      return { ...stamp(base, "declined"), declineReason: "Your prescriber needs to see you in clinic before the next refill.", canRequestAgain: true };
    case "rejected":
      return { ...stamp(stamp(stamp(stamp(base, "approved"), "submitted"), "in_review"), "rejected"), rejectReason: "The result window was blurry. Please take a new photo." };
    case "rejected_new_link":
      return {
        ...stamp(stamp(stamp(stamp(base, "approved"), "submitted"), "in_review"), "rejected"),
        rejectReason: "The result window was blurry. Please take a new photo.",
      };
    case "missed":
      return { ...stamp(stamp(stamp(stamp(base, "approved"), "submitted"), "window_open"), "missed"), pickupDeadline: new Date(Date.now() - DAY).toISOString() };
  }
}
