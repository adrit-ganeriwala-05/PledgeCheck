# PledgeCheck PRD v3 — End-to-End Flow

Sep 27, 2026 · @Adrit Ganeriwala

## Overview

PledgeCheck v3 turns monthly iPLEDGE pregnancy testing into a self-service loop: the patient requests a refill in a portal, the clinic approves, a one-time test link is emailed automatically, and the verified result opens a 7-day pickup window.

Isotretinoin causes severe birth defects, so iPLEDGE requires patients who can become pregnant to test every month before each prescription. The FDA's February 2026 change (taking effect in November 2026) will allow at-home tests but require prescribers to prevent misreading and falsification, without saying how. PledgeCheck is that process.

**What changes from v2**

| Area | v2 (built) | v3 (this PRD) |
| --- | --- | --- |
| Who starts a cycle | Clinician issues a link from /patients | Patient requests a refill in their portal |
| Link delivery | QR and URL shown once to the clinician | Emailed to the patient automatically on approval |
| Patient identity | Pseudonym, no account | Patient account (email + password) linked to a pseudonymous patient record |
| Photo checks | Grok + OpenCV readers, pHash from the OpenCV service | Grok reads validity, code, faint lines and confidence; pHash reuse check |
| Pickup | Clinician taps "Mark filled" | Same, recorded in the database and the audit chain |

The privacy line changes with patient accounts: we now store an email address. We still store no name, date of birth or ID number, so the pitch becomes "an email to reach you, nothing that says who you are."

## Users and roles

Three roles, two approvals: staff approve the refill request, and only a prescriber approves the test result.

| Role | Signs in at | Can do |
| --- | --- | --- |
| Patient | Landing page → patient portal | Sign up with an enrollment code, request a refill, take the test from the emailed link, see request status and pickup deadline |
| Staff | /login → clinician dashboard | See the practice's patients, approve or decline refill requests (which sends the link), mark prescriptions picked up |
| Prescriber | /login → clinician dashboard | Everything staff can do, plus review and approve or reject test results in /queue |

A patient only ever sees their own requests. Clinicians see only their own practice's patients, enforced by row-level security as in v2.

## End-to-end flow

Every monthly cycle passes two clinic approvals: staff approve the refill request, then a prescriber approves the test result.

[embedded content: end-to-end flow · 10 steps across patient, system and clinic]

The highlighted step is the one missing today. A declined request or a rejected result emails the patient with the reason; a rejected result can be retaken with a fresh link, and a missed window closes the cycle.

## What we have vs what's missing

The test-taking half of the flow is built; the patient half (accounts, refill requests) and the automatic email are not, and the live link bug breaks every emailed link until it's fixed.

| Step | Status | Today | Needed for v3 |
| --- | --- | --- | --- |
| Link origin | Broken | `api/requests/route.ts:25` hardcodes `https://pledgecheck.tech`, which is down, so every issued link is dead on Vercel | Build links from an `APP_ORIGIN` env var. Must land before email, or every email carries a dead link |
| Patient sign-up and login | Missing | Patients are pseudonymous rows with no account | Supabase Auth patient accounts, linked to a patient row by enrollment code |
| Refill request | Missing | No request object; clinicians start cycles | `refill_requests` table, patient "Request refill" button, status view |
| Approval sends email | Missing | Link shown once as QR and URL to the clinician | Approve → create link → email patient automatically (see the email section) |
| One-time link and challenge code | Partial | Token hash, code revealed only after Start, camera-only capture | Also require the logged-in patient to match the link's patient |
| Grok read | Built | Reads the photo, 0.85 confidence threshold, `low_confidence` flag | Confirm the prompt covers control line, code match and faint lines (see safety section) |
| Photo-reuse check | Partial | pHash comes from the Vultr OpenCV service, which is down, so the check silently never runs | Compute pHash inside the Next.js route so it doesn't depend on Vultr |
| Flag labels | Broken | Pipeline emits flags the labels map doesn't know, so they render raw | One shared flag vocabulary with labels |
| Prescriber review | Built | `/queue` cards, approve or reject in one tap | Also email the patient on reject |
| 7-day window | Built | Approval opens it; `/windows` lists it | Also email the patient the pickup deadline |
| Missed window | Missing | Derived in the browser only; nothing writes a `missed` event | A scheduled sweep that closes windows and emails the patient |
| Pickup recorded | Partial | "Mark filled" on `/windows` | Confirm it writes an audit event and closes the cycle |

The redesigned UI wasn't shared in this chat, so the rows above reflect the build as of 26 Sep 22:45.

## Requirements

Twelve P0 requirements make the demo flow work end to end; the three P1s handle time passing (expiry, missed windows, reminders).

| ID | Stage | Requirement | Priority |
| --- | --- | --- | --- |
| R1 | Portal | Patient signs up with email, password and a clinic enrollment code, which links the account to one pseudonymous patient row | P0 |
| R2 | Portal | Patient home shows the current cycle's status and, when open, the pickup deadline | P0 |
| R3 | Portal | "Request refill" creates a request; only one open cycle per patient at a time | P0 |
| R4 | Clinic | Staff see a requests inbox and approve, or decline with a reason | P0 |
| R5 | Clinic | Approving creates the one-time link and emails it to the patient automatically, with no copy-paste step | P0 |
| R6 | Clinic | A failed email shows on the request with a "Resend link" button; resending invalidates the old link | P0 |
| R7 | Test | The link only works for the logged-in patient it was issued to | P0 |
| R8 | Test | Grok reports control line present, test line (none, faint or clear), challenge code read and a confidence score | P0 |
| R9 | Test | Photo-reuse check runs in-process on every submission; if it can't run, the card says so | P0 |
| R10 | Review | Prescriber approve opens the 7-day window and emails the deadline; reject emails the reason | P0 |
| R11 | Pickup | Staff mark picked up; the cycle closes | P0 |
| R12 | All | Every transition writes an audit event; no token, code or email address goes into an audit reason | P0 |
| R13 | Test | Challenge code expires if no photo arrives within a set time after Start | P1 |
| R14 | Pickup | A daily sweep marks unfilled windows as missed and emails the patient | P1 |
| R15 | Pickup | Reminder email 24 hours before the window closes | P1 |

Cycle status runs: requested → approved (link sent) → submitted → in review → window open → picked up, with declined, rejected and missed as exits.

## Automatic link email on approval

Send the email with Resend from the approve route itself: claim the request, issue the link with the existing logic, look up the patient's email server-side, send, and record whether it went out. A failed send never undoes the approval; staff see it and resend.

**Why Resend:** a single API call from a Next.js route on Vercel, and the free tier covers the demo at 100 emails a day and 3,000 a month ([Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)). Supabase's built-in mailer only sends auth emails (sign-up confirmation, password reset), not app notifications.

**The catch to plan around:** until a domain is verified, Resend only sends from `onboarding@resend.dev` and only to the Resend account owner's own address; any other recipient gets a 403 ([Apidog](https://apidog.com/blog/resend-api-key/)). Verifying `mail.pledgecheck.tech` only needs DNS records (DKIM, SPF and an MX for bounces), so it works even while the website on that domain is down.

### Setup

1. Fix the link origin first: replace the hardcoded `https://pledgecheck.tech` in `api/requests/route.ts` with an `APP_ORIGIN` env var (`https://pledgecheck.vercel.app` today). Otherwise every email carries a dead link.
2. Create a Resend account and add the domain `mail.pledgecheck.tech`; Adrit adds the DNS records it shows.
3. Add `RESEND_API_KEY`, `EMAIL_FROM` (`PledgeCheck <noreply@mail.pledgecheck.tech>`) and `APP_ORIGIN` in Vercel.
4. `npx --yes pnpm@10.34.5 --filter web add resend`
5. Move the token and challenge-code creation out of `POST /api/requests` into a shared `issueLink(patientId, setting)` so both the old route and the new approve route use it.

**Demo fallback if DNS isn't verified in time:** set `EMAIL_FROM` to `onboarding@resend.dev` and make the demo patient's email the Resend account owner's address. The live demo then works unchanged.

### The email sender

```ts
// apps/web/lib/email/send-test-link.ts
import { Resend } from "resend";

type Result = { ok: true; id: string } | { ok: false; error: string };

export async function sendTestLinkEmail(opts: {
  to: string;
  link: string;
  expiresAt: Date;
  idempotencyKey: string;
}): Promise<Result> {
  // Fail soft, like analytics: a missing key must never break approval
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { ok: false, error: "email_disabled" };
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
      {
        from: process.env.EMAIL_FROM,
        to: opts.to,
        subject: "Your PledgeCheck link is ready",
        html: `<p>Your clinic approved your request.</p>
               <p><a href="${opts.link}">Start your monthly check</a></p>
               <p>The link works once and expires ${opts.expiresAt.toUTCString()}.</p>`,
      },
      { idempotencyKey: opts.idempotencyKey },
    );
    if (error || !data) return { ok: false, error: error?.name ?? "send_failed" };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}
```

### The approve route

```ts
// apps/web/app/api/refill-requests/[id]/approve/route.ts
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const clinician = await getClinician(); // existing helper
  if (!clinician) return new Response(null, { status: 401 });
  const { id } = await params;
  const db = await createServerClient(); // clinician session, so RLS scopes to their practice

  // 1. Claim the request: a conditional update means only one approval can win
  const { data: request } = await db
    .from("refill_requests")
    .update({ status: "approved", approved_by: clinician.id, approved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "requested")
    .select("id, patient_id")
    .single();
  if (!request) return Response.json({ error: "not_pending" }, { status: 409 });

  // 2. Issue the one-time link with the existing logic
  const { token, testRequestId, expiresAt } = await issueLink(request.patient_id, "home");
  const link = `${process.env.APP_ORIGIN}/t/${token}`; // never log this

  // 3. Email lives in auth.users; read it with the service role, server-side only
  const email = await getPatientEmail(request.patient_id);

  // 4. Send; a failure is recorded, not thrown
  const sent = await sendTestLinkEmail({
    to: email,
    link,
    expiresAt,
    idempotencyKey: `test-link/${testRequestId}`, // a resend issues a new link, so a new key
  });

  await db
    .from("refill_requests")
    .update({
      test_request_id: testRequestId,
      email_status: sent.ok ? "sent" : "failed",
      email_message_id: sent.ok ? sent.id : null,
    })
    .eq("id", id);

  await auditAppend({ type: sent.ok ? "link_emailed" : "link_email_failed", refillRequestId: id });

  return Response.json({ emailStatus: sent.ok ? "sent" : "failed" });
}
```

`getPatientEmail`, `issueLink` and `auditAppend` are the names to create or map onto existing helpers. The "Resend link" button calls the same route logic with a new `issueLink`, after marking the old test request unusable.

### Rules for the email

- The email carries the link only. The challenge code stays hidden until the patient taps Start.
- The subject and preview say "PledgeCheck", not "pregnancy test" or "isotretinoin", because they show on lock screens.
- The link only works for the logged-in patient it was issued to (R7), so a forwarded email is useless on its own.
- No token, link or email address goes into logs, analytics or audit reasons.
- The same sender handles the other emails in R10, R14 and R15: approved with deadline, rejected with reason, missed window, 24-hour reminder.

## Data model changes

One new table (`refill_requests`), two columns on `patients`, one on `test_requests`, and patient RLS policies. `db/schema.sql` is Adrit's file: post this in team chat before merging, and keep migrations in sync with `bash db/sync-migrations.sh --check`.

| Table | Change | Why |
| --- | --- | --- |
| `patients` | Add `auth_user_id uuid unique` (references `auth.users`, null until enrolled) | Links a login to a pseudonymous patient; the email stays in `auth.users`, not in our tables |
| `patients` | Add `enrollment_code_hash`, `enrollment_code_expires_at` | Staff generate a code; the patient enters it at sign-up. Stored hashed, like link tokens |
| `refill_requests` (new) | `id`, `patient_id`, `practice_id`, `status` (requested, approved, declined, cancelled), `decline_reason`, `approved_by`, `approved_at`, `test_request_id`, `email_status` (sent, failed, disabled), `email_message_id`, `created_at` | The patient-started cycle, and where the email outcome is recorded |
| `test_requests` | Add `invalidated_at` | "Resend link" retires the old link before issuing a new one |
| Fill windows | Add a `missed` status written by the sweep | Today "missed" exists only in the browser |

**RLS for patients:** a patient can read their own `patients` row and their own `refill_requests` (joined on `auth_user_id = auth.uid()`), and insert a request only for themselves while no cycle is open. Clinician policies stay practice-scoped as in v2. Patients never get read access to `test_requests`, reader outputs or flags.

## Security, privacy and clinical safety

The AI flags; a prescriber decides. No result is ever approved automatically, and anything unclear goes to a human.

**Faint lines must escalate, never pass.** On most home tests, any visible test line, however faint, counts as positive. So Grok's job is to detect a faint line and flag it (`faint_test_line`, severity high), never to read a faint line as negative. The rules:

- No control line: the test is invalid, and the patient is asked to retest.
- Control line and no test line, code matches, confidence at or above 0.85: shown as a clean read for the prescriber.
- Any test line, faint or clear: flagged, and the prescriber sees it first.
- Low confidence, code mismatch or unreadable code: flagged for manual review.

The patient never sees Grok's reading, only "Submitted, your clinic will review it."

**Access controls**

- Enrollment codes stop strangers from signing up and requesting isotretinoin: an account only exists if a clinic issued its code.
- The test link needs both the token and the matching logged-in patient.
- The challenge code appears only after Start, and (R13) expires if no photo follows in time.

**Privacy**

- The email address lives only in Supabase's `auth.users`. Our tables keep the pseudonym, and there's still no name, date of birth or ID number.
- Emails avoid medical words in the subject and preview.
- Keep `RESEND_API_KEY` out of chats and the repo. The six keys already pasted into a chat transcript still need rotating.

**Attacks we don't stop, stated honestly:** a patient photographing a test run with someone else's urine, live and with the correct code, passes every check. Only a supervised test prevents that, and the threat-model slide should say so.

## Open decisions and risks

Six decisions block parts of the build; the biggest risk is the email domain not verifying before the demo, and the fallback covers it.

**Decisions**

- [ ] Does the OpenCV reader stay in v3? The flow above uses Grok plus the reuse check only. Keeping OpenCV restores "readers disagree → review" and the Vultr prize, but only if `api.pledgecheck.tech` comes back.
- [ ] Who approves refill requests: any staff member, or only prescribers?
- [ ] Who records pickup: staff (current "Mark filled"), or a patient "I picked it up" that staff confirm? No pharmacy is connected.
- [ ] How long after Start must the photo arrive (R13)? It has to cover the test's development time on the package instructions.
- [ ] How long is an emailed link valid before it expires?
- [ ] What does a missed window require in later months? The rules engine only handles a missed first-prescription window (`engine.ts:16` TODO).

**Risks**

| Risk | Impact | Fallback |
| --- | --- | --- |
| `mail.pledgecheck.tech` doesn't verify in time | Emails to the demo patient return a 403 | Send from `onboarding@resend.dev` to the Resend account owner's address |
| Link origin still hardcoded | Every emailed link is dead | Fix it first (setup step 1) |
| Vultr service stays down | No reuse check if pHash still comes from it | Compute pHash in-process (R9) |
| Email lands in spam | Patient never sees the link | Portal home also shows a "Start your test" button for the approved cycle |
| Schema change merge conflicts | Blocks other branches | Post in team chat first; one migration for all v3 changes |

## Build order and demo

Build in dependency order: link origin and schema first, then the email, then the portal. Owners follow each person's existing area.

| # | Task | Owner | Needs |
| --- | --- | --- | --- |
| 1 | Replace hardcoded link origin with `APP_ORIGIN` | Adrit | — |
| 2 | v3 schema migration and patient RLS | Adrit | Posted in team chat |
| 3 | Resend account, `mail.pledgecheck.tech` DNS records, Vercel env vars | Adrit | — |
| 4 | Extract `issueLink` from `POST /api/requests`; bind links to the logged-in patient | Nihalika | 2 |
| 5 | Approve route with automatic email, and "Resend link" | Adrit | 1, 3, 4 |
| 6 | Patient sign-up with enrollment code, portal home, "Request refill" | Labib | 2 |
| 7 | Requests inbox on the clinician dashboard | Adrit | 5 |
| 8 | Grok prompt: control line, faint test line, code read, confidence; new flags and labels | Labib | — |
| 9 | In-process pHash for the reuse check | Nihalika | — |
| 10 | Result, deadline and pickup emails | Adrit | 5 |
| 11 | Missed-window sweep and reminders (P1) | Labib | 10 |

**Demo script (about 90 seconds, phone and laptop side by side)**

1. On the phone, the patient logs in and taps "Request refill".
2. On the laptop, staff approve it in the requests inbox.
3. The email arrives on the phone within seconds. The patient opens it, taps Start, and the challenge code appears.
4. The patient photographs the test with the code in frame and submits.
5. The card appears in the prescriber's queue with Grok's read, confidence and flags.
6. The prescriber approves; the phone gets the pickup-deadline email.
7. Staff mark it picked up, and the audit chain shows every step, verified.

Rehearse the whole script on the deployed build with the real phone before recording the video.
