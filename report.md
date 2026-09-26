# PledgeCheck: Adrit's P0 report (A1–A6)

HackGT, Saturday 26 September 2026. All six P0 tickets are built, tested locally and committed on
stacked branches. Nothing is pushed or deployed yet. Deployment is a set of manual steps in
`DEPLOY.md`.

## What's ready

| Ticket | What it delivers | Branch (head) |
|---|---|---|
| A1 App backbone | pnpm workspace; Next.js 16 app in `apps/web` (strict TypeScript, Tailwind 4, shadcn/ui); lazily validated env (`lib/env.ts` server-only, `lib/env.public.ts` browser-safe); `.env.example` files; vitest | `adrit/A1-app-backbone` (`3891b39`) |
| A2 Supabase | Nine-table schema, RLS, private `photos` bucket, `submit_review` RPC, synthetic seed, Supabase clients and generated types, session-refresh `proxy.ts` | `adrit/A2-supabase-schema` (`48b532a`) |
| A3 Domain and Vultr (repo side) | Dockerfile, docker-compose (read-only API behind Caddy), Caddyfile for `api.pledgecheck.tech`, `DEPLOY.md` | `adrit/A3-domain-vultr` (`580706c`) |
| A4 Analyze service | `POST /analyze` (FastAPI): service-key auth, 12 MiB limit, EXIF-aware pHash, **uncalibrated** line reader, photo never touches disk; `apps/analyze/CONTRACT.md` | `adrit/A4-analyze-service` (`d03e623`) |
| A5 Review queue | `GET /api/queue`, `POST /api/reviews`, `/queue` page, integration adapters for the window and audit modules, local end-to-end script | `adrit/A5-review-queue` (`abf6b4a`) |
| A6 Queue polish | Amber `needs_review` cards with specific reasons, flag badges (unknown flags shown raw), skeleton, empty and error states, per-card pending state, collapse on success, refresh every 20 s and on focus, A/R keyboard shortcuts | `adrit/A6-queue-polish` (`0fbc28b`) |

`adrit/A6-queue-polish` contains all of the above. A follow-up code audit added three fixes on
`adrit/audit-fixes` (head `e5d1103`, stacked on A6), so that branch is now the latest:

- **Reviews are recorded only by the server.** Before, a signed-in prescriber could call the review
  database function directly from the browser, or insert a `reviews` row. That skipped the rules
  engine, the audit event and photo deletion, and could leave a test stuck in the queue.
  `submit_review` is now executable by the service role only. It takes the clinician id from the
  route, which verified the session, and re-checks it. The client insert policy on `reviews` is
  gone. A window that closes before it opens is also rejected.
- **Queue photos no longer reload every 20 seconds.** Each signed URL is reused for up to
  4 minutes.
- **The `/analyze` response is validated before it is sent.** A Pydantic model checks the five
  keys, types, ranges and lateral-flow consistency; a violation returns 500 instead of a
  malformed read.

## What blocks the demo

- **Approving a test returns 503 until Labib's window function exists.** The route never computes
  dates. It asks `lib/integrations/window.ts`, which delegates to `lib/rules` once that exists.
- **Every review reports `audit_failed` until Nihalika's audit module exists.** The decision is still
  saved, the photo is still deleted, and the response says `reviewRecorded: true`.
  `lib/integrations/audit.ts` is the place to wire it in.
- **The OpenCV reader is not calibrated.** No real test photos exist yet, so its confidence is capped
  at 0.50. Every submission it reads therefore lands in `needs_review`, never on the fast path.
- **There is no `/login` page yet** (Nihalika). The queue links to `/login` when there is no session.

## Handoffs

### Labib
- Implement the approval-window function to the contract at the top of
  `apps/web/lib/integrations/window.ts`:
  `openApprovalWindow({ patientId, submissionId, approvedAt }) → { opensAt, closesAt, isFirstRx }`.
  Then import it there. Don't add date math to the reviews route.
- Analyze service contract (`apps/analyze/CONTRACT.md`):
  - multipart field `image`, header `X-Service-Key`, maximum 12 MiB;
  - response is exactly `{ result, controlLine, testLine, confidence, phash }`;
  - `result` is one of `positive | negative | invalid`.
  Please confirm these match L4.
- Treat any non-200 answer from `/analyze` as "OpenCV read unavailable" and route the submission to
  `needs_review`. Never treat it as a negative.
- The final flag vocabulary for `submissions.flags` is yours to set. The queue labels a few known
  flags (`components/queue/flags.ts`) and shows any other flag as its raw value.

### Nihalika
- Implement `append({ actor, action, refId, payload })` in `lib/audit` to the contract in
  `apps/web/lib/integrations/audit.ts`. Reviews send `actor: "clinician:<uuid>"`,
  `action: "review.approved" | "review.rejected"` and `refId: <submission id>`. Please confirm the event
  names.
- **Tamper demo:** `audit_events` has a trigger that blocks UPDATE and DELETE, even from the SQL
  editor and the service role. To edit a row on purpose for the demo, run:
  ```sql
  alter table public.audit_events disable trigger audit_events_no_update_delete;
  -- edit the row
  alter table public.audit_events enable trigger audit_events_no_update_delete;
  ```
- `audit_events` has no practice column, so any clinician can read every audit row. Users who aren't
  clinicians see none.
- Decide who creates `submissions` rows: link issue (`awaiting_photo`) or capture. The photo and read
  columns are nullable, so either works.

### Whole team
- **Real test photos.** Put labelled photos in `apps/analyze/tests/fixtures/photos/`, following the
  README there (label from the physical test; strip GPS data first). Then run
  `pytest -q -s tests/test_real_photos.py` to measure accuracy and tune `lines.py`.
- **Reject reason.** A reason is currently required to reject (500 characters maximum) and optional
  to approve. Change this in `apps/web/lib/clinic/review.ts` if the team decides otherwise.

## Provisional defaults

Each default lives in one place so it's easy to change.

| # | Open question | Current default | Where |
|---|---|---|---|
| 1 | OpenCV algorithm and confidence | Uncalibrated baseline, confidence capped at 0.50 | `apps/analyze/lines.py` (`CALIBRATED`, constants at the top) |
| 2 | Labib's window function | Adapter; returns 503 if unavailable; no local date math | `apps/web/lib/integrations/window.ts` |
| 3 | Who inserts the `windows` row | `submit_review` RPC, using the dates it is given | `db/functions.sql` |
| 4 | Countdown before approval | "Captured Xh ago · 7-day window opens on approval"; live countdown only once a window exists | `components/queue/window-countdown.tsx` |
| 5 | Audit API and event names | Adapter; `review.approved` / `review.rejected` | `apps/web/lib/integrations/audit.ts` |
| 6 | Drug-maker role | No schema change; non-clinician logins see nothing | `db/policies.sql` |
| 7 | Who creates `submissions` rows | Photo and read columns nullable | `db/schema.sql` |
| 8 | Flag vocabulary; reject reason | Unknown flags shown raw; reason required on reject | `components/queue/flags.ts`, `lib/clinic/review.ts` |

Other decisions worth knowing:
- **Photo deletion after a failed audit write.** The photo is still deleted, and the response is
  still `500 audit_failed` with `reviewRecorded: true`.
- **One extra queue card field: `grok.codeMatches`** (`boolean | null`). The card needs it to show
  whether Grok's code matches the issued code. The field is additive; everything else matches the
  agreed shape.
- **Reviews only through `POST /api/reviews`.** `submit_review(p_clinician_id, p_submission_id,
  p_decision, p_reason, p_window)` can be called by the server only. Any new review logic must go
  through the route, which is the only path that runs the rules engine, writes the audit event
  and deletes the photo.
- **Early 409.** The reviews route returns 409 for a submission that isn't reviewable before calling
  the RPC. The RPC enforces the same rule under a row lock, so two prescribers racing each other also
  get a 409.
- **Uploads stay in memory.** The analyze service keeps uploads in memory: the multipart spool
  threshold is raised above 12 MiB. As a second layer, the container runs with a read-only root
  filesystem and a RAM-backed `/tmp`.
- **Low-confidence label.** The card calls a read "low confidence" below 0.85. This is display only;
  the rules engine sets the status.
- **Library choices.** OpenCV is pinned to 4.14 (not the new 5.0). The shadcn `cn` npm package was
  replaced with the standard `clsx` + `tailwind-merge`.

## API contracts (as built)

**`GET /api/queue`**
- Returns 401 without a session, 403 for a user with no clinicians row.
- Otherwise returns `{ cards: Card[] }`: only `ready_for_review` and `needs_review` submissions from
  the clinician's practice, with `needs_review` first, then oldest capture first.
- Each card: `submissionId`, `status`, `capturedAt`, `patient { pseudonym, phase, language }`,
  `photoUrl` (5-minute signed URL, or null), `grok { result, code, confidence, codeMatches }`,
  `opencv { result, confidence }`, `readersAgree`, `flags`, `window { opensAt, closesAt, isFirstRx } | null`
  and `canReview` (prescribers only).

**`POST /api/reviews`**
- Body: `{ submissionId, decision: "approved" | "rejected", reason? }`.
- Success: 200 `{ status, window: { opensAt, closesAt } | null }`.

| Status | Meaning |
|---|---|
| 400 | Invalid body, or reject without a reason |
| 401 | No session |
| 403 | Staff, or not a clinician |
| 404 | Unknown submission, or another practice's |
| 409 | Already reviewed, or not reviewable |
| 503 | `window_logic_unavailable`; nothing written |
| 500 | `audit_failed` or `photo_delete_failed` (both with `reviewRecorded: true`), or another server error |

**`POST https://api.pledgecheck.tech/analyze`**: see `apps/analyze/CONTRACT.md`.

## Test status

| Suite | Result |
|---|---|
| Web (`pnpm test`) | 88 passed, 11 files; lint, typecheck and build (empty env) pass |
| Database (`npx supabase@2.118.0 test db db/tests`) | 66/66 pgTAP: RLS isolation, no privilege escalation, server-only reviews, RPC error codes, window order, audit immutability, storage policy |
| Analyze (`pytest`, Python 3.12+) | 71 passed, 2 skipped (no real photos) |
| Local end-to-end (`apps/web/scripts/e2e-local.mjs`) | 12/12 against local Supabase and `next start`, including the browser-bypass check |
| Production Docker image | Health 200; 401 without a key; contract JSON with a key; 415 for non-images; nothing written to `/tmp` |

**Not yet verified:**
- HTTPS on `api.pledgecheck.tech`;
- anything on Vercel or Vultr, or on a real phone;
- approval end to end over HTTP (waits on the window function);
- OpenCV accuracy (waits on real photos).

## Running it locally

See `README.md`. In short:

```sh
pnpm install
npx supabase@2.118.0 start && npx supabase@2.118.0 db reset
pnpm dev                         # after filling apps/web/.env.local from .env.example
pnpm lint && pnpm typecheck && pnpm test && pnpm build
npx supabase@2.118.0 test db db/tests
```

- The dev logins (`prescriber1@example.test` and others) and their password are in `README.md`.
- To run the analyze tests, see `apps/analyze/CONTRACT.md`. They need Python 3.12+, or Docker.
- After editing any `db/*.sql` file, run `db/sync-migrations.sh`.

## Deployment

`DEPLOY.md` lists every manual step with a verification command:
- MLH codes (stop and ask the team if `pledgecheck.tech` is taken);
- Vercel with Root Directory `apps/web`, env vars and domain;
- get.tech DNS;
- the Vultr instance and firewall;
- `docker compose up` with a generated `SERVICE_KEY`;
- the three curl checks;
- the Supabase SQL files in order, and the private-bucket check.

If HTTPS isn't working after one hour, tell the team before switching to Railway, since the switch
gives up the Vultr prize.

## Schema contract (unchanged from the PRD)

- `practices` (id, name, created_at)
- `clinicians` (id → auth.users, practice_id, role `prescriber|staff`, display_name)
- `patients` (id, practice_id, pseudonym, can_get_pregnant, home_testing_allowed, phase `pre|during|after|complete`, treatment_start, language `en|es`)
- `test_requests` (id, patient_id, token_hash unique, challenge_code char(4), setting `home|clinic`, expires_at, used_at, created_by)
- `submissions` (id, request_id unique, photo_path, phash, captured_at, grok_result, grok_code, grok_confidence, cv_result, cv_confidence, flags text[], status `awaiting_photo|rejected_fraud|needs_review|ready_for_review|approved|rejected|expired`)
- `reviews` (id, submission_id unique, clinician_id, decision `approved|rejected`, reason, decided_at)
- `windows` (id, patient_id, submission_id, is_first_rx, opens_at, closes_at, filled_at, status `open|filled|missed`)
- `audit_events` (seq bigserial, actor, action, ref_id, payload jsonb, created_at, prev_hash, hash)
- `anchors` (id, head_seq → audit_events.seq, head_hash, solana_signature, cluster default `devnet`, created_at)

Indexes: `submissions(status)`, `test_requests(patient_id)`, `windows(patient_id, status)`,
`patients(practice_id)`.
