# PledgeCheck v3 API contracts (backend checklist)

Every endpoint the v3 frontend calls, marked **existing** (wired as it behaves today) or **needed from backend**. The types are the source of truth in `apps/web/lib/api/contracts.ts`; the calls are in `apps/web/lib/api/client.ts`. This file mirrors them for review.

## How to switch an endpoint on

1. Build the route to the contract below.
2. In `apps/web/lib/api/mode.ts`, change the endpoint from `"pending"` to `"live"`.
3. Delete its function from `lib/api/mocks/index.ts` once nothing depends on it.

Mocks never run in production (`NODE_ENV === "production"` forces them off). In development:

| `NEXT_PUBLIC_API_MOCKS` | What answers from the mock adapter |
| --- | --- |
| unset | Nothing. Every call hits the real server |
| `1` | Only the "needed from backend" endpoints below |
| `all` | Everything, including Supabase auth and the server-rendered `/patients` and `/windows` data: an offline demo with no Supabase project (not `/audit`) |

While any mock is on, every page shows an amber **Mock data** tab on the left edge. It can jump the portal to any cycle state, switch the clinic role (in `all` mode) and reset the mock data.

## Error shape

Every client function returns `{ ok: true, data } | { ok: false, error: { code, status } }`. The client reads the error code from the JSON `error` field (the `/t` start route also accepts `state`). On top of each endpoint's own codes, any call can fail with:

| Code | When |
| --- | --- |
| `network_error` | fetch threw (status 0) |
| `unauthenticated` | 401 |
| `not_a_clinician` | 403 without a known code |
| `not_available` | 404 with no JSON body: the route doesn't exist yet |
| `rate_limited` | 429 |
| `server_error` | anything else, or a 2xx whose body isn't the promised shape |

Please answer errors as JSON `{ "error": "<code>" }` so the codes below reach the screens.

## Shared cycle model

```ts
type CycleStatus =
  | "requested" | "approved" | "submitted" | "in_review" | "window_open" | "picked_up" // happy path
  | "declined" | "rejected" | "missed";                                               // exits

type EmailStatus = "sent" | "failed" | "disabled";

type Cycle = {
  id: string;
  status: CycleStatus;
  timestamps: Partial<Record<CycleStatus, string>>; // ISO time each status was reached
  emailStatus: EmailStatus | null;   // while approved
  pickupDeadline: string | null;     // while window_open (keep it for picked_up / missed)
  declineReason: string | null;
  rejectReason: string | null;
  testLinkAvailable: boolean;        // an unused, unexpired link exists (drives "Start your test")
  canRequestAgain: boolean;          // after a decline
};
```

The patient-facing `Cycle` must **never** include a token, link, challenge code, reader output, confidence or flag.

- `submitted` means the photo arrived. `in_review` means it's in the prescriber queue. The portal shows both as "Submitted, your clinic will review it", so returning only `in_review` is fine.
- `rejected` covers a prescriber rejecting the result. Set `testLinkAvailable: true` once a fresh link has been issued.

---

## Needed from backend

### Patient portal

| Purpose | Method and path | Request | Response | Errors | Used by |
| --- | --- | --- | --- | --- | --- |
| Link a new account to a clinic (R1) | `POST /api/patient/enroll` | `{ enrollmentCode: string }` (patient session, after Supabase `signUp`) | `{ patientId }` | 404 `invalid_code`, 410 `expired_code`, 409 `already_enrolled`, 401 | `/portal/signup`, `/portal` (not-enrolled state) |
| Current cycle (R2) | `GET /api/patient/cycle` | — | `{ cycle: Cycle \| null }` | 401 (→ portal login), **403 `not_enrolled`** (signed in, no linked patient row; the portal then asks for the code) | `/portal` (polled every 15 s) |
| Request a refill (R3) | `POST /api/refill-requests` | — (patient session) | `{ requestId }` | 409 `cycle_already_open`, 403 `not_enrolled` | `/portal` |
| "Start your test" fallback | `POST /api/patient/test-link` | — (patient session) | `{ testPath: "/t/<token>" }` | 409 `no_test_link` | `/portal` |

**Why the test-link route exists:** tokens are stored hashed, so the server can't give back the emailed link. The portal fallback (PRD risk: "email lands in spam") needs the server to return a usable link path, most likely by issuing a fresh one and retiring the old one, as "Resend link" does. The browser only follows a path matching `^/t/[A-Za-z0-9_-]+$`, and never stores or logs it.

`POST /api/refill-requests` is the same path as the clinic list below: `POST` from a patient creates a request, and `GET` from a clinician lists them. Split it into `/api/patient/refill-requests` if that's simpler, and tell the frontend.

### Clinic: refill requests

| Purpose | Method and path | Request | Response | Errors | Used by |
| --- | --- | --- | --- | --- | --- |
| Requests inbox (R4) | `GET /api/refill-requests?status=requested` | — | `RefillRequest[]` (bare array) | 401, 403 | `/requests` (polled every 10 s) |
| Failed-email list (R6) | `GET /api/refill-requests?status=approved&emailStatus=failed` | — | `RefillRequest[]` | 401, 403 | `/requests` |
| Approve, which sends the email (R5) | `POST /api/refill-requests/[id]/approve` | — | `{ emailStatus: "sent" \| "failed" \| "disabled" }` | 409 `not_pending`, 404 `not_found` | `/requests` |
| Decline (R4) | `POST /api/refill-requests/[id]/decline` | `{ reason: string }` (1–500 chars; the patient sees it) | `{ ok: true }` | 400 `reason_required`, 409 `not_pending`, 404 `not_found` | `/requests` |
| Resend the link (R6) | `POST /api/refill-requests/[id]/resend-link` | — | `{ emailStatus }` | 409 `not_resendable`, 404 `not_found` | `/requests` |

```ts
type RefillRequest = {
  id: string;
  patientId: string;
  pseudonym: string;
  status: "requested" | "approved" | "declined" | "cancelled";
  requestedAt: string;
  emailStatus: EmailStatus | null;
  declineReason: string | null;
};
```

- The new query parameter `emailStatus` filters approved requests to the failed ones.
- `not_pending` on approve or decline means someone else acted first. The inbox says so and refreshes.
- Resend should retire the old link (`test_requests.invalidated_at`) before issuing the new one. If it still fails, return `200 { emailStatus: "failed" }`; the row stays in the list.
- `disabled` means `RESEND_API_KEY` or `EMAIL_FROM` isn't set. The badge tells staff the patient can start from the portal.

### Clinic: enrollment

| Purpose | Method and path | Request | Response | Errors | Used by |
| --- | --- | --- | --- | --- | --- |
| Generate an enrollment code (R1) | `POST /api/patients/[id]/enrollment-code` | — | `{ code, expiresAt }` (the code is shown once) | 409 `already_enrolled`, 404 `not_found` | `/patients` |
| Portal status per patient | `GET /api/patients/portal-status` | — | `{ patients: { patientId, enrolled: boolean, cycleStatus: CycleStatus \| null }[] }` | 401, 403 | `/patients` "Portal" column |

- **Added by the frontend; not in the brief's table.** `/patients` reads the patients table in a server component, and `auth_user_id` doesn't exist yet, so enrollment status comes from this endpoint. Until it exists the column shows "—" and the code button is offered to everyone. If you prefer, add `enrolled` to the server-side patients query instead and tell the frontend.
- Expected code format: 8 characters, shown as `XXXX-XXXX`. The client sends it trimmed, as typed; normalize case and dashes on the server.

---

## Existing endpoints (wired as they behave today)

| Endpoint | Client function | Used by | v3 additions the frontend already handles |
| --- | --- | --- | --- |
| `POST /api/requests` | `issueTestLink` | `/patients` "Home link" / "Clinic link" | — (fix `PRODUCTION_ORIGIN` → `APP_ORIGIN`, PRD setup step 1) |
| `PATCH /api/patients/[id]/home-testing` | `setHomeTesting` | `/patients` | — |
| `GET /api/queue` | `getQueue` | `/queue` (polled every 3 s) | Optional card fields, see below |
| `POST /api/reviews` | `submitReview` | `/queue` | Reject already requires a reason. Email the patient from here (R10) |
| `POST /api/windows/fill` | `markPickedUp` | `/windows` "Mark picked up" | — |
| `POST /api/t/[token]/start` | `startTestSession` | `/t/[token]` | New error codes and `codeExpiresAt`, see below |
| `POST /api/submissions` | `submitTestPhoto` | `/t/[token]` | — |
| `GET /api/audit/verify` | `verifyAudit` | `/audit` | — |
| `POST /api/anchors` | `anchorAuditHead` | `/audit` | — |
| Supabase Auth `signUp`, `signInWithPassword`, `signOut` | `patientSignUp`, `patientSignIn`, `patientSignOut` | `/portal/*`, `/t/[token]` | `emailRedirectTo` is `<origin>/portal` |

### `POST /api/t/[token]/start` (PRD R7, R13)

Today: `200 { ok, state: "active", sessionEndsAt, challengeCode }`, `404 { state: "invalid" }`, `409 { state }`.

The frontend also handles these v3 answers:

| Status | Body | Screen |
| --- | --- | --- |
| 401 | `{ error: "not_logged_in" }` | Sign-in form **on the link page itself**; after sign-in it calls Start again |
| 403 | `{ error: "wrong_patient" }` | "This link belongs to a different account" with Sign out |
| 410 | `{ error: "invalidated" }` | Replaced by a newer link → portal |
| 410 | `{ error: "expired" }` | Expired → portal |
| 410 | `{ error: "already_used" }` | Already used → portal |
| 200 | adds `codeExpiresAt` (ISO) | Countdown runs to the sooner of `sessionEndsAt` and `codeExpiresAt`; at zero, "Your code has expired" → portal |

A bare 401 or 403 without a code is treated as `not_logged_in` or `wrong_patient`.

**Session cookie on `/t`:** `proxy.ts` excludes `t/` and `api/t/` from the matcher, so the Supabase session isn't refreshed on those routes. When the start route starts checking the patient session, include them in the matcher or refresh the session in the route.

### `GET /api/queue`: optional v3 card fields (PRD R8)

`QueueCard.grok` gains three optional fields. The UI shows "Not reported" when they are absent, never a clean value:

```ts
grok: {
  // existing: result, code, confidence, codeMatches
  controlLine?: boolean | null;                   // false → "Missing: test invalid"
  testLine?: "none" | "faint" | "clear" | null;   // faint or clear → high-severity banner, sorted first
  expectedCode?: string | null;                   // shown as "Code read K7Q2 · issued K7Q2"; send only if clinicians may see it
}
```

### Flag vocabulary (`components/queue/flags.ts`)

Existing labels are kept. The v3 additions:

| Flag | Label | Severity |
| --- | --- | --- |
| `faint_test_line` | Faint test line: possible positive | **clinical (high)** |
| `test_line_present` | Test line visible: possible positive | clinical (high) |
| `control_line_missing` | No control line: test invalid | review |
| `code_unreadable` | Code unreadable | review |
| engine reason `positive result; …` | (sentence) | clinical (high) |

Clinical flags render as solid red chips, list first, put a banner on the card, and turn any "negative" read on that card into "Possible positive". Unknown flags render as received, with an "unrecognized" style.

## Endpoints the frontend does **not** call

- `GET /api/t/[token]`: the `/t` page reads link status server-side through `getLinkStatus` (unchanged).
- `/patients`, `/windows` and `/audit` read Supabase directly in server components under RLS, unchanged. `/windows` already shows `status = missed` rows and derives "missed" once `closes_at` has passed. When the R14 sweep writes `missed`, the derived branch in `window-list.tsx` can go.
