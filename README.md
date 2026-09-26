# PledgeCheck

The FDA now lets isotretinoin patients take their iPLEDGE pregnancy test at
home, but only if the prescriber sets up a process to stop misread and faked
tests. The rule does not say what that process is. PledgeCheck is one.

A clinic issues a one-time link. The patient opens it on a phone, writes a
four-character challenge code on the test, and photographs it through the live
camera. Five fraud checks and two independent readers run, a deterministic
rules engine decides, and a dermatologist approves in one tap. Every action
extends a hash chain whose head is anchored on Solana devnet, so a later edit
is provable.

Built at HackGT 13. **Every patient in this repo is synthetic.**

## How it fits together

```
patient phone ──► Next.js API (Vercel) ──┬──► Grok vision      (result + code)
                                         └──► Vultr OpenCV     (lines + phash)
                                                   │
                                            rules engine
                                                   │
                                      dermatologist review queue
                                           │             │
                            Supabase audit log      Tiger Data (de-identified)
                                    │                      │
                            Solana devnet            drug-maker dashboard
                            (32-byte head hash)
```

Solana stores only a 32-byte fingerprint of the audit log — never a test
result, a patient or an event. It proves the log was not edited after
anchoring. It does not prove a photo was genuine; the fraud checks do that.

## Repo layout

```
apps/web/            Next.js App Router app, deployed to Vercel
  app/t/[token]/     patient capture page (phone, live camera only)
  app/(clinic)/      windows, queue, audit, patients
  app/(pharma)/      drug-maker dashboard
  app/api/           route handlers
  lib/rules/         the rules engine and its unit tests
  lib/ai/            Grok vision reader, Vultr analyze client
  lib/fraud/         one-time links, challenge code, photo reuse
  lib/audit/         hash chain
  lib/analytics/     Tiger Data writes and reads
  public/audio/      pre-generated ElevenLabs clips (en, es)
apps/analyze/        FastAPI + OpenCV image service, deployed to Vultr
db/                  schema.sql, policies.sql, seed.sql, tiger.sql
scripts/gen-voice.ts writes the voice clips
```

## Running it

```bash
npm install
cp .env.example .env.local        # fill from Vercel; never commit values
npm run dev --workspace apps/web
npm test                          # rules engine unit tests
```

The patient capture page needs a real camera over HTTPS. Test it on a Vercel
preview URL, not on localhost.

## Fraud checks, in the order they run

| # | Check | Catches |
|---|---|---|
| 1 | One-time link | Someone else using or reusing a patient's link |
| 2 | Live camera only | An old, downloaded or edited image |
| 3 | Challenge code | A photo taken before the link was issued |
| 4 | Photo reuse (perceptual hash) | The same photo sent twice, or a cropped copy |
| 5 | Two independent readers | A misread result, or a doctored line |

Two attacks these do **not** stop yet, and we say so in the pitch: a patient
using someone else's negative test, and a live screen re-photographed with the
code written on paper.

## Rules engine

`evaluate(patient, submission, reads, now)` is pure and deterministic. AI
output is one of its inputs, never its decision, and it never auto-approves —
the best it returns is `ready_for_review`.

Encoded from the February 2026 iPLEDGE changes, effective August 2026:
the first pre-treatment test must be in a medical setting; home tests only
where the prescriber permits; a 7-day pickup window; a missed first-Rx window
means a repeat test in a medical setting with no waiting period; patients who
cannot get pregnant skip the loop entirely.

## Credits

Public frameworks: Next.js, React, Tailwind CSS, Supabase, FastAPI, OpenCV,
imagehash, TimescaleDB, `@solana/web3.js`, Caddy, Vitest, zod.

Sponsor technology: xAI Grok vision (SpaceXAI), Vultr, .Tech, ElevenLabs,
Solana devnet, Tiger Data.

AI use is logged per the HackGT rules and stated in the Devpost write-up: what
AI tools generated versus what the team wrote this weekend.
