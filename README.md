# PledgeCheck

**At-home iPLEDGE pregnancy tests a dermatology practice can actually trust.**

From November 2026 the FDA will let isotretinoin patients take their pregnancy test at home —
but only if the prescriber sets up a process to stop misread and faked tests. The rule does
not say what that process is. PledgeCheck is one.

A clinic issues a one-time link. The patient opens it on a phone, taps Start to reveal a
four-character challenge code, writes it on the test, and photographs it through the live
camera. Five fraud checks and two independent readers run, a deterministic rules engine
decides, and a dermatologist approves in one tap.

Built at HackGT 13. **Every patient in this repo is synthetic.**

---

## Status

Honest state of the build. Nothing is deployed yet.

| Area | State |
|---|---|
| Patient capture, submission pipeline, rules engine, windows, dashboard | Built, tested |
| Supabase schema, RLS, review queue, analyze service | Built, tested |
| Approvals end to end | Works locally; **needs a real phone over HTTPS** |
| Login, patients screen, "issue link" | Built, tested: `/login` routes by role; `/patients` issues links (with QR code) and toggles home testing |
| One-time link session and challenge code | Built, tested: the code stays hidden until the patient taps Start, and uploads need an active 40-minute session |
| Hash-chained audit log | Built, tested: one writer (`lib/audit/append.ts`) through the `audit_append` database function; reviews, links, sessions, fraud rejections and fills are all logged. Verify screen at `/audit`; see [`docs/AUDIT.md`](docs/AUDIT.md) |
| Solana anchor | Built, tested: devnet memo of the chain head (Anchor now, and automatically every 10 events); verified against the on-chain memo. Live anchor confirmed locally; not yet on the deployed app |
| ElevenLabs voice clips | Generator written; **clips not generated**, so the capture page falls back to on-screen text |
| Tiger Data | Schema and writes exist; **no warehouse provisioned**, and only `filled` events are written today |
| OpenCV reader | **Uncalibrated**, confidence capped at 0.50, so every submission lands in `needs_review` until real test photos exist |

Adrit's detailed A1–A6 report, including the provisional defaults he chose, is in
[`report.md`](report.md).

## How it fits together

```
patient phone ──► Next.js API (Vercel) ──┬──► Grok vision      (result + handwritten code)
                                         └──► Vultr OpenCV     (lines + perceptual hash)
                                                   │
                                            rules engine
                                                   │
                                      dermatologist review queue
                                           │             │
                                    Supabase audit    Tiger Data (de-identified)
                                           │                    │
                                    Solana devnet         drug-maker dashboard
                                   (32-byte head hash)
```

Solana would store only a 32-byte fingerprint of the audit log — never a test result, a
patient or an event. It proves the log was not edited after anchoring. It does **not** prove
a photo was genuine; the fraud checks do that.

## Repo layout

| Path | What | Owner |
|---|---|---|
| `apps/web/app/t/[token]/` | Patient capture page, phone, live camera only | Labib |
| `apps/web/app/login/` | Clinic sign-in, role routing, sign-out | Nihalika |
| `apps/web/app/(clinic)/patients/` | Patients list, home-testing switch, "issue link" | Nihalika |
| `apps/web/app/(clinic)/queue/` | Dermatologist review queue | Adrit |
| `apps/web/app/(clinic)/windows/` | Pickup-window countdown, "Mark filled" | Labib |
| `apps/web/app/(pharma)/dashboard/` | Drug-maker dashboard | Labib |
| `apps/web/lib/rules/` | Rules engine and its unit tests | Labib |
| `apps/web/lib/ai/` | Grok vision reader, analyze-service client | Labib |
| `apps/web/lib/analytics/` | Tiger Data writes and reads | Labib |
| `apps/web/lib/fraud/` | Links, sessions, challenge code, photo reuse; see [`lib/fraud/README.md`](apps/web/lib/fraud/README.md) | Nihalika |
| `apps/web/lib/audit/` | Hash-chained audit log: canonical JSON, writer, verifier | Nihalika |
| `apps/web/lib/integrations/` | Adapters between the review route and teammate modules | Adrit (contract) |
| `apps/web/lib/supabase/`, `lib/env.ts` | Clients, generated types, lazily validated env | Adrit |
| `apps/analyze/` | FastAPI + OpenCV image service (Vultr) | Adrit |
| `db/` | Schema, RLS policies, functions, seed, pgTAP tests — source of truth | Adrit |
| `supabase/` | Local Supabase CLI config; `migrations/` mirrors `db/*.sql` | Adrit |
| `scripts/gen-voice.ts` | Writes the ElevenLabs clips into `apps/web/public/audio` | Labib |

## Local development

Requires Node, pnpm 10 and Docker.

```sh
pnpm install
npx supabase@2.118.0 start          # local Postgres, Auth, Storage
npx supabase@2.118.0 db reset       # apply db/*.sql and db/seed.sql
cp .env.example apps/web/.env.local # fill in values from `npx supabase@2.118.0 status`
pnpm dev
```

After editing any `db/*.sql` file, run `db/sync-migrations.sh` to refresh `supabase/migrations/`.

The patient capture page needs a real camera over HTTPS. Test it on a Vercel preview URL,
never on localhost.

### Checks

| Command | Covers |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint, then `next typegen && tsc --noEmit` |
| `pnpm test` | 369 vitest tests across 38 files |
| `pnpm build` | Must pass with an empty environment: `lib/env.ts` validates lazily, at the point of use |
| `npx supabase@2.118.0 test db db/tests` | 78 pgTAP assertions: RLS isolation, server-only reviews, audit immutability, `audit_append` chain checks |
| `node scripts/e2e-local.mjs`, `node scripts/e2e-link-flow.mjs` (in `apps/web`) | Against local Supabase and `next start` on :3100: queue and reviews (13 checks); links, Start, home-testing switch, early upload rejections, and every audit hash re-verified (15 checks) |
| `pytest` in `apps/analyze` | Image service (Python 3.12+); see [`apps/analyze/CONTRACT.md`](apps/analyze/CONTRACT.md) |

The first four run in CI on every push (`.github/workflows/test.yml`).

### Dev logins (local seed only)

Sign in at `/login`. Prescribers land on `/queue` and staff on `/patients`.

| Email | Role | Practice |
|---|---|---|
| `prescriber1@example.test` | prescriber | Demo Dermatology North |
| `staff1@example.test` | staff | Demo Dermatology North |
| `prescriber2@example.test` | prescriber | Demo Dermatology South |
| `staff2@example.test` | staff | Demo Dermatology South |

Password for all four: `pledgecheck-dev`. These accounts exist only in the local seed; never
run `db/seed.sql` against a project holding real data.

## Patient flow

1. **Issue.** On `/patients`, staff or a prescriber clicks **Home link** or **Clinic link**.
   - The link is shown once, with a QR code. It must be started within 24 hours.
   - Only a hash of its token is stored. Home links are refused for pre-treatment patients, for
     patients without home testing turned on, and for patients who cannot get pregnant.
2. **Start.** The patient opens the link on a phone and taps **Start**.
   - This begins a 40-minute session and only now reveals the four-character challenge code, with
     a countdown.
   - A photo taken before Start cannot contain the code. Reopening the link mid-session shows the
     same code.
3. **Capture.** The patient writes the code on the test and photographs it through the live
   camera.
4. **Check.** `POST /api/submissions` runs the fraud checks below, both readers and the rules
   engine. Every fraud rejection is written to the audit log with its reason only.
5. **Review.** Reviewable tests appear in the prescriber's `/queue`. Approving opens the 7-day
   pickup window.

Details and states: [`apps/web/lib/fraud/README.md`](apps/web/lib/fraud/README.md).

## Fraud checks, in the order they run

| # | Check | Catches |
|---|---|---|
| 1 | One-time link, active session | Someone else using, or reusing, a patient's link; an upload outside the 40-minute session |
| 2 | Live camera only | An old, downloaded or edited image |
| 3 | Challenge code | A photo taken before the patient tapped Start |
| 4 | Photo reuse (perceptual hash) | The same photo sent twice, or a cropped copy |
| 5 | Two independent readers | A misread result, or a doctored line |

The cheap checks run first, so a replayed link or a reused photo never costs an AI call.

Two attacks these do **not** stop yet, and the pitch says so out loud: a patient using
someone else's negative test, and a live screen re-photographed with the code on paper.

The Hamming distance of 8 and the 0.85 confidence threshold are starting values. Both need
tuning on real test photos, which do not exist yet.

## Rules engine

`evaluate(patient, submission, reads, now)` is pure and deterministic: no clock, no network,
no database. AI output is one of its inputs, never its decision, and it never auto-approves —
the best it can return is `ready_for_review`.

Encoded from the February 2026 iPLEDGE changes, which take effect in November 2026: the first
pre-treatment test must be in a medical setting; home tests only where the prescriber
permits; a 7-day pickup window; a missed first-Rx window means a repeat test in a medical
setting with no waiting period; patients who cannot get pregnant skip the loop entirely.

> **Unconfirmed.** These rules are coded against secondary sources. Every one still needs
> checking against the official iPLEDGE prescriber guide, and what a missed window requires
> in *later* months is genuinely unknown. See the TODO at the top of `lib/rules/engine.ts`.

## Data and privacy

Patient-level data lives only in Supabase; every store downstream holds strictly less.

| Store | Holds | Never holds |
|---|---|---|
| Supabase | Pseudonym, category, phase, requests, submissions, reviews, windows, audit | Names, dates of birth, SSNs |
| Analyze service | The photo in memory while it is read | Anything on disk after the response |
| Tiger Data | Event type, week, practice id, days from test to fill | Patient ids, pseudonyms, photos, results tied to a person |
| Solana devnet | One 32-byte hash of the audit-chain head | Any result, patient, practice or event detail |

Secrets live in Vercel and on the Vultr instance. `.env.example` lists variable names only.

## Credits

Public frameworks: Next.js, React, Tailwind CSS, shadcn/ui, Supabase, FastAPI, OpenCV,
imagehash, TimescaleDB, Caddy, Vitest, pgTAP, zod.

Sponsor technology: xAI Grok vision (SpaceXAI), Vultr, .Tech, ElevenLabs, Solana devnet,
Tiger Data.

Per the HackGT rules, the Devpost write-up states what AI tools generated versus what the
team wrote this weekend.
