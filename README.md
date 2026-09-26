# PledgeCheck

**At-home iPLEDGE pregnancy tests a dermatology practice can actually trust.**

Since August 2026 the FDA lets isotretinoin patients take their pregnancy test at home —
but only if the prescriber sets up a process to stop misread and faked tests. The rule does
not say what that process is. PledgeCheck is one.

A clinic issues a one-time link. The patient opens it on a phone, writes a four-character
challenge code on the test, and photographs it through the live camera. Five fraud checks
and two independent readers run, a deterministic rules engine decides, and a dermatologist
approves in one tap.

Built at HackGT 13. **Every patient in this repo is synthetic.**

---

## Status

Honest state of the build. Nothing is deployed yet.

| Area | State |
|---|---|
| Patient capture, submission pipeline, rules engine, windows, dashboard | Built, tested |
| Supabase schema, RLS, review queue, analyze service | Built, tested |
| Approvals end to end | Works locally; **needs a real phone over HTTPS** |
| Login, patients screen, "issue link" | **Not built** — so links cannot yet be issued in-app |
| Hash-chained audit log | Interim implementation only; `lib/integrations/audit.ts` still throws, so **every review returns `500 audit_failed`** after saving the decision |
| Solana anchor | **Not built** |
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
| `apps/web/app/(clinic)/queue/` | Dermatologist review queue | Adrit |
| `apps/web/app/(clinic)/windows/` | Pickup-window countdown, "Mark filled" | Labib |
| `apps/web/app/(pharma)/dashboard/` | Drug-maker dashboard | Labib |
| `apps/web/lib/rules/` | Rules engine and its unit tests | Labib |
| `apps/web/lib/ai/` | Grok vision reader, analyze-service client | Labib |
| `apps/web/lib/analytics/` | Tiger Data writes and reads | Labib |
| `apps/web/lib/fraud/`, `lib/audit/` | One-time links, photo reuse, hash chain — **interim** | Nihalika to replace |
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
| `pnpm test` | 108 vitest tests across 12 files |
| `pnpm build` | Must pass with an empty environment: `lib/env.ts` validates lazily, at the point of use |
| `npx supabase@2.118.0 test db db/tests` | 66 pgTAP assertions: RLS isolation, server-only reviews, audit immutability |
| `pytest` in `apps/analyze` | Image service (Python 3.12+); see [`apps/analyze/CONTRACT.md`](apps/analyze/CONTRACT.md) |

The first four run in CI on every push (`.github/workflows/test.yml`).

### Dev logins (local seed only)

| Email | Role | Practice |
|---|---|---|
| `prescriber1@example.test` | prescriber | Demo Dermatology North |
| `staff1@example.test` | staff | Demo Dermatology North |
| `prescriber2@example.test` | prescriber | Demo Dermatology South |
| `staff2@example.test` | staff | Demo Dermatology South |

Password for all four: `pledgecheck-dev`. These accounts exist only in the local seed; never
run `db/seed.sql` against a project holding real data.

## Fraud checks, in the order they run

| # | Check | Catches |
|---|---|---|
| 1 | One-time link | Someone else using, or reusing, a patient's link |
| 2 | Live camera only | An old, downloaded or edited image |
| 3 | Challenge code | A photo taken before the link was issued |
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

Encoded from the February 2026 iPLEDGE changes, effective August 2026: the first
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
