# PledgeCheck v3 frontend gap audit

Compares the frontend in `apps/web` against `notes/PledgeCheck_PRD_v3.md` (R1–R15, the "What we have vs what's missing" table, the end-to-end flow and the security section).

- **Audited:** 27 Sep 2026, before any v3 feature code.
- **Baseline checks:** `test` 489 passed / 1 skipped, `typecheck`, `lint` and `build` all clean.
- **Status key:** **Built** · **Built, not wired** (UI exists on placeholder data) · **Partial** (some states missing) · **Missing**.
- **Final status** was added after the build (see the end of this file).

## Routes at baseline (`next build`)

| Route | Kind | Notes |
| --- | --- | --- |
| `/` | static | Landing (redesign). Only clinician entry points (`/login`) |
| `/login`, `/login/continue`, `/login/no-access`, `/login/sign-out` | mixed | Clinician Supabase login, role redirect via `destinationFor` |
| `/patients` | dynamic | Server-loaded table, home-testing toggle, issue link (QR + URL shown once) |
| `/queue` | static shell | Client `QueueBoard`, polls `/api/queue` every 3 s with an in-flight guard |
| `/windows` | dynamic | Server-loaded open and missed windows, "Mark filled" |
| `/audit` | dynamic | Hash-chain table, anchors, Verify and Anchor now |
| `/dashboard` | dynamic | Drug-maker weekly totals (Tiger Data) |
| `/t/[token]` | dynamic | Patient capture flow (server link check → client flow) |
| `/api/*` | dynamic | 11 route handlers, listed below |

## Existing API routes (connect exactly as they are)

| Method and path | Request | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/requests` | `{ patientId, setting: "home" \| "clinic" }` | `{ requestId, link, expiresAt }` | 400 `invalid_json`/`invalid_request`, 401 `unauthenticated`, 403 `not_a_clinician`, 404 `not_found`, 409 `home_testing_not_allowed` + `reason` (`not_permitted`, `pre_treatment`, `cannot_get_pregnant`), 500 `issue_failed`/`audit_failed` |
| `GET /api/queue` | — | `{ cards: QueueCard[] }` (`lib/clinic/queue.ts`) | 401, 403, 500 `queue_failed` |
| `POST /api/reviews` | `{ submissionId, decision: "approved" \| "rejected", reason? }` (reason required to reject) | `{ status, window: { opensAt, closesAt } \| null }` | 400 `invalid_json`/`invalid_request`, 401, 403 `not_a_clinician`/`prescriber_only`/`forbidden`, 404 `not_found`, 409 `not_reviewable`/`already_reviewed`, 503 `window_logic_unavailable`, 500 `window_logic_failed`/`review_failed`/`audit_failed`/`photo_delete_failed` (the last three may carry `reviewRecorded: true`) |
| `POST /api/submissions` | multipart `token`, `image` (jpeg/png/webp ≤ 4 MB) | `{ submissionId, status, received, reasons }` | 400/413/415/404/500/502 `{ submissionId: null, status: "error", reason }`; 410 `{ status: "expired" \| "rejected_fraud", reason }` with `reason` in `invalid_link`, `session_not_started`, `session_expired`, `already_submitted` |
| `GET /api/t/[token]` | — | `{ ok, state, language, sessionEndsAt, challengeCode }` (code only while active) | 404 `state: "invalid"`, 429 `rate_limited`, 500 `error` |
| `POST /api/t/[token]/start` | — | `{ ok: true, state: "active", sessionEndsAt, challengeCode }` | 404 `invalid`, 409 `{ ok: false, state }` (`session_expired`, `link_expired`, `submitted`), 429, 500 |
| `POST /api/windows/fill` | `{ windowId }` | `{ ok: true, daysToFill }` or `{ ok: true, alreadyFilled: true }` | 400/401/403/404 `{ ok: false, reason }`, 409 window no longer open |
| `PATCH /api/patients/[id]/home-testing` | `{ allowed }` | `{ patientId, allowed, changed }` | 400, 401, 403, 404, 500 `update_failed`, 500 `audit_failed` + `changed: true` |
| `GET /api/audit/verify` | — | `VerifyResult` | 401, 403, 500 `verify_failed` |
| `POST /api/anchors` | — | `{ signature, explorerUrl, headSeq, headHash, reused }` | 401, 403, 409 `nothing_to_anchor`, 500/502 Solana errors |
| `GET /api/dashboard` | — | `{ source, smallCountFloor, rows }` | — |

No `/api/patient/*`, `/api/refill-requests*` or enrollment-code routes exist.

## Auth at baseline

- **Clinicians:** Supabase email + password on `/login` → `/login/continue` → `destinationFor(getClinician())`: prescriber → `/queue`, staff → `/patients`, no clinicians row → `/login/no-access`.
- **Roles:** `clinicians.role` is `prescriber` or `staff`. Only `/api/reviews` enforces prescriber-only; the nav shows the same four links to both roles.
- **`proxy.ts`:** refreshes the Supabase session cookie on every request except `/t/*` and `/api/t/*`. No redirects; access control is in RLS and each route.
- **Patients:** no auth of any kind. `/t/[token]` is open to anyone holding the token.

## Gap matrix

### Patient side

| # | Screen, state or requirement | PRD | Status | Files | What's left |
| --- | --- | --- | --- | --- | --- |
| P1 | Landing: "Patient sign in" entry point | Flow | **Missing** | `components/landing/sections.tsx` | Only "Sign in" / "Sign in as a clinician" → `/login` |
| P2 | Landing: "Clinician sign in" entry point | Flow | **Built** | same | Keep; label it clearly next to the patient entry |
| P3 | Sign up `/portal/signup` (email, password, enrollment code) | R1 | **Missing** | — | Page, Supabase `signUp`, `POST /api/patient/enroll`, messages for `invalid_code`, `expired_code`, `already_enrolled`, existing email, "check your email" |
| P4 | Patient login `/portal/login` with validated `next` | R1, R7 | **Missing** | `app/login/*` is clinician-only | Page and a same-origin relative `next` validator |
| P5 | Portal home `/portal`: cycle status timeline + one next action | R2, R3 | **Missing** | — | Page for all 10 cycle states |
| P6 | "Request refill", disabled while a cycle is open | R3 | **Missing** | — | Button, `cycle_already_open` handling |
| P7 | Pickup deadline with live countdown | R2 | **Missing** | — | Countdown on the `window_open` state |
| P8 | "Start your test" fallback button when email is lost | Risks | **Missing** | — | Needs `Cycle.testLinkAvailable` plus a way to open the link without showing the token (see contracts) |
| P9 | `/t/[token]` camera-only capture, code after Start | Sec. | **Built** | `app/t/[token]/*` | Keep. No file input; code only from the start response |
| P10 | `/t/[token]` not logged in | R7 | **Missing** | — | Handle `401 not_logged_in` from start |
| P11 | `/t/[token]` wrong patient | R7 | **Missing** | — | Handle `403 wrong_patient`, sign-out option |
| P12 | `/t/[token]` invalidated / expired / already-used link | R6, R7 | **Partial** | `link-problem.tsx`, `lib/voice.ts` | `link_expired`, `session_expired`, `submitted`, `invalid` exist; `invalidated` and the 410 codes don't; no way back to the portal |
| P13 | `/t/[token]` code countdown and expiry | R13 | **Partial** | `capture-flow.tsx` | Session countdown on `sessionEndsAt` (40 min) is built; `codeExpiresAt` not read; expired state doesn't point back to the portal |
| P14 | Patient never sees reads, flags or fraud words | Sec. | **Built** | `capture-flow.tsx` (`patientMessage`) | Keep; add tests covering the new screens |

### Clinic side

| # | Screen, state or requirement | PRD | Status | Files | What's left |
| --- | --- | --- | --- | --- | --- |
| C1 | Role-based nav; permission map in one place | Roles | **Partial** | `components/clinic/clinic-nav.tsx` | Same links for every role; no permission map; no Requests link |
| C2 | Requests inbox `/requests` | R4 | **Missing** | — | Page, pending list with pseudonym, time and age |
| C3 | Approve → email status badge | R5 | **Missing** | — | Approve call, `sent` / `failed` / `disabled` badge |
| C4 | Decline with required reason | R4 | **Missing** | — | Reason form |
| C5 | Failed email stays visible with "Resend link" | R6 | **Missing** | — | Resend call and state |
| C6 | `409 not_pending` handling | R5 | **Missing** | — | Refresh the list and say someone else acted |
| C7 | Patients table | R1 | **Built** | `app/(clinic)/patients/*` | Keep |
| C8 | "Enrolled / Not enrolled" column | R1 | **Missing** | — | Needs enrollment data from the backend |
| C9 | Generate enrollment code (shown once, copy, expiry) | R1 | **Missing** | — | Dialog in the link-dialog pattern |
| C10 | Existing "Issue link" keeps working | v2 | **Built** | `issue-link.tsx`, `link-dialog.tsx` | Move its fetch into the API layer |
| C11 | Queue: explicit Grok fields (control line, test line none/faint/clear, code read vs expected, confidence) | R8 | **Partial** | `components/queue/readers-panel.tsx`, `lib/clinic/queue.ts` | Result, confidence and code match are shown; control line and test-line strength aren't in the API; the issued code isn't returned (only the match) |
| C12 | One flag vocabulary with labels and severities; unknown flags safe | Flags | **Partial** | `components/queue/flags.ts` | Every flag the current pipeline emits is labeled, and unknown flags render raw with an "unknown" style. `faint_test_line` is missing, and there's no high clinical severity (a positive read shows amber) |
| C13 | `faint_test_line` renders high severity, never as clean | Safety | **Missing** | same | Add the flag, a high severity above fraud, and a card banner |
| C14 | `opencv_unavailable` / `reuse_check_unavailable` say which check didn't run | R9 | **Built** | `flags.ts` (`degradedNotes`), `queue-card.tsx` | Keep |
| C15 | Reject requires a reason | R10 | **Built** | `review-actions.tsx`, `lib/clinic/review.ts` | Move the fetch into the API layer |
| C16 | New cards without a manual refresh | R8 | **Built** | `queue-board.tsx` (3 s poll, in-flight guard, pauses when hidden) | Keep |
| C17 | Windows: missed windows as their own status | R14 | **Partial** | `app/(clinic)/windows/*` | Reads `status = missed` from the DB and also derives "missed" in the browser when `closes_at` has passed. No sweep writes `missed` yet (backend) |
| C18 | "Mark filled" labeled "Mark picked up" | R11 | **Partial** | `window-list.tsx` | Rename; move the fetch into the API layer |
| C19 | Audit timeline with chain status | R12 | **Built** | `app/(clinic)/audit/*`, `components/audit/*` | Keep. Reads audit_events under RLS in a server loader; `/api/audit/verify` and `/api/anchors` drive the actions |

### Cross-cutting

| # | Item | Status | What's left |
| --- | --- | --- | --- |
| X1 | Single typed API layer (`lib/api/contracts.ts`, `client.ts`) | **Missing** | Browser `fetch` calls sit in 6 components: `capture-flow.tsx`, `queue-board.tsx`, `review-actions.tsx`, `issue-link.tsx`, `home-testing-toggle.tsx`, `window-list.tsx` (plus `components/audit/*`) |
| X2 | Per-endpoint mock adapter behind `NEXT_PUBLIC_API_MOCKS=1`, never in production | **Missing** | Adapter, guard and badge |
| X3 | "Mock data" badge on every page | **Missing** | Root layout component |
| X4 | Shared cycle status union and copy maps | **Missing** | `contracts.ts`, patient copy, clinic badge map |
| X5 | Link origin (`APP_ORIGIN`) | **Backend** | `api/requests/route.ts:25` still hardcodes `https://pledgecheck.tech` in production. Out of frontend scope; listed for the backend checklist |
| X6 | Playwright | **Not installed** | No E2E framework in the repo |

## Codebase vs PRD

- The PRD says flag labels are "Broken" (raw flags). In the redesign every flag the current pipeline emits already has a label, and engine sentences are labeled too. What's missing is `faint_test_line` and a high clinical severity.
- The PRD lists R13 (code expiry) as future work. A 40-minute session countdown already exists on `sessionEndsAt` and ends the flow at zero; only the `codeExpiresAt` contract is new.
- Missed windows are not purely browser-derived: `/windows` also shows rows the DB already marks `missed`.

## Final status (after the build)

**Checks:** `test` 637 passed / 1 skipped (was 489), `typecheck`, `lint` and `build` clean. The full mocked flow (sign up → request → approve → email outcome → start test → camera capture → submit → queue → approve → pickup countdown → mark picked up) was also driven in headless Chromium with `NEXT_PUBLIC_API_MOCKS=all`, at 360 and 390 px (patient) and 1280 px (clinic), with no page errors.

**"Wired, mocked"** means the UI calls the typed client, and the endpoint answers from the mock adapter until the backend ships it (see `notes/v3-api-contracts.md`).

| # | Item | Final status | Where |
| --- | --- | --- | --- |
| P1 | Landing "Patient sign in" | **Built** | `components/landing/story.tsx`, `sections.tsx` (hero, closing, nav) |
| P2 | Landing "Clinician sign in" | **Built** | same |
| P3 | `/portal/signup` | **Built, wired (auth live, enroll mocked)** | `app/portal/signup`, `components/portal/signup-form.tsx` |
| P4 | `/portal/login` with validated `next` | **Built, wired** | `app/portal/login`, `components/portal/patient-sign-in-form.tsx`, `lib/auth/next-path.ts` |
| P5 | `/portal` timeline and next action, all 10 states | **Built, wired, mocked** | `components/portal/portal-home.tsx`, `cycle-timeline.tsx`, `lib/cycle/copy.ts` |
| P6 | Request refill, disabled while a cycle is open | **Built, wired, mocked** | `portal-home.tsx` |
| P7 | Pickup deadline countdown | **Built** | `components/portal/pickup-countdown.tsx` |
| P8 | "Start your test" fallback | **Built, wired, mocked** (needs `POST /api/patient/test-link`) | `portal-home.tsx` |
| P9 | Camera-only capture, code after Start | **Built** (unchanged, re-tested) | `app/t/[token]/capture-flow.tsx` |
| P10 | `/t` not logged in | **Built** (inline sign-in, no redirect) | `capture-flow.tsx` |
| P11 | `/t` wrong patient | **Built** | `capture-flow.tsx` |
| P12 | `/t` invalidated / expired / already used | **Built** (EN + ES, portal link) | `capture-flow.tsx`, `link-problem.tsx`, `lib/voice.ts` |
| P13 | `/t` code countdown and expiry | **Built** (`codeExpiresAt` when present) | `capture-flow.tsx` |
| P14 | No reads, flags or fraud words on patient screens | **Built, tested** | `portal-home.test.tsx`, `lib/cycle/copy.test.ts` |
| C1 | Role-based nav, one permission map | **Built** | `lib/auth/permissions.ts`, `components/clinic/clinic-nav.tsx`, `lib/clinic/role.ts` |
| C2–C6 | Requests inbox: approve + email badge, decline with reason, failed email + Resend, 409 | **Built, wired, mocked** | `app/(clinic)/requests`, `components/requests/requests-inbox.tsx` |
| C7 | Patients table | **Built** (kept) | `app/(clinic)/patients` |
| C8 | Enrolled / Not enrolled column | **Built, wired, mocked** (needs `GET /api/patients/portal-status`) | `portal-status.tsx` |
| C9 | Generate enrollment code (shown once) | **Built, wired, mocked** | `enrollment-code.tsx` |
| C10 | Issue link still works | **Built, wired (live)** | `issue-link.tsx` |
| C11 | Explicit Grok fields | **Built** (control line and test line show "Not reported" until the pipeline sends them) | `components/queue/readers-panel.tsx` |
| C12 | One flag vocabulary; unknown flags safe | **Built** | `components/queue/flags.ts` |
| C13 | `faint_test_line` high severity, never clean | **Built, tested** | `flags.ts`, `flag-badges.tsx`, `queue-card.tsx`, `readers-panel.tsx`, `sort.ts` |
| C14 | Degraded checks say which didn't run | **Built** (kept) | `flags.ts` |
| C15 | Reject requires a reason | **Built, wired (live)** | `review-actions.tsx` |
| C16 | Live queue | **Built** (3 s poll kept) | `queue-board.tsx` |
| C17 | Missed windows as their own status | **Built** (DB status, or derived until the R14 sweep) | `window-list.tsx` |
| C18 | "Mark picked up" | **Built, wired (live)** | `window-list.tsx` |
| C19 | Audit timeline and chain status | **Built** (kept; Verify and Anchor now go through the client) | `components/audit/*` |
| X1 | Single typed API layer | **Built** | `lib/api/contracts.ts`, `lib/api/client.ts`; no component calls `fetch` |
| X2 | Per-endpoint mocks, never in production | **Built, tested** | `lib/api/mode.ts`, `lib/api/mocks/*` |
| X3 | Mock data badge | **Built** | `components/dev/mock-badge.tsx` (root layout) |
| X4 | Shared cycle model and copy maps | **Built** | `lib/api/contracts.ts`, `lib/cycle/copy.ts` |
| X5 | `APP_ORIGIN` | **Backend** (not touched) | `app/api/requests/route.ts:25` |
| X6 | Playwright E2E in the repo | **Not added** | No framework installed; the flow was verified with a scratch script instead |

## Handoff notes

- **Patient login is separate from clinician login.** `/portal/login` vs `/login`. The clinician flow routes through `getClinician` and `/login/continue`. A patient account has no clinicians row and would land on `/login/no-access`, and there is no backend patient-role lookup yet. One combined login can come later, once `GET /api/patient/cycle` exists to tell the two apart.
- **Signed-out patients sign in on the test link itself**, instead of being redirected to `/portal/login?next=/t/<token>`. The brief both asks for that redirect and forbids tokens in URLs we construct; signing in in place satisfies R7 without putting the token in a login URL. `next` is still supported and validated on `/portal/login` (the portal uses it).
- **Staff now land on `/requests`** after sign-in (was `/patients`), through `ROLE_HOME` in `lib/auth/permissions.ts`. Staff don't see Queue in the nav. `/queue` itself still works for them, read-only, as before.
- **Missed windows are still derived in the browser** when `closes_at` has passed and the row is still `open` (`window-list.tsx`). Remove that branch once the R14 sweep writes `status = missed`.
- **Server-component reads stay where they were** (`patients/load.ts`, `windows/page.tsx`, `audit/load.ts`): server-only, RLS-scoped and already tested. Everything the browser fetches goes through `lib/api/client.ts`.
- **`/queue` became dynamic** in the build, because the clinic layout now reads the clinician's role for the nav.
- **`proxy.ts` skips `/t` and `/api/t`,** so the session cookie isn't refreshed there. The backend needs to handle this when R7 lands (see the contracts doc).
- **Portal copy is English only.** The capture flow, including its new v3 screens, is English and Spanish.
