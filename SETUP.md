# Building PledgeCheck from nothing

Every step to get this system running, in the order that works. Written after doing it
for real, so the traps are marked where you hit them rather than in a footnote.

`DEPLOY.md` covers deploying what already exists. This covers building it from zero.

---

## 0. What you are building

Four services and one database. Nothing is optional except where marked.

```
                    pledgecheck.tech
                   (domain, DNS records only)
                          │
            ┌─────────────┴──────────────┐
   pledgecheck.tech              api.pledgecheck.tech
   www.pledgecheck.tech                  │
            │                            │
        ┌───▼────┐                  ┌────▼────┐
        │ VERCEL │                  │  VULTR  │
        └───┬────┘                  └────┬────┘
            │                            │
  Next.js: every page and         FastAPI + OpenCV + imagehash
  every /api/* route              in Docker behind Caddy.
                                  Reads test lines, computes pHash.
            │
            ├──► SUPABASE     Postgres, auth, photo storage
            ├──► TIGER DATA   de-identified analytics warehouse
            ├──► xAI GROK     vision read of the test and the handwritten code
            ├──► SOLANA       devnet anchor of the audit chain head
            └──► RESEND       emails the one-time test link
```

The browser only ever talks to Vercel. Vercel talks to everything else server-side.

---

## 1. Accounts to create

Do these first; several take minutes to verify.

| Service | What for | Cost |
|---|---|---|
| **GitHub** | the repo | free |
| **Supabase** | database, auth, photo storage | free tier |
| **Vercel** | hosts the Next.js app | free (Hobby) |
| **xAI** | Grok vision | credits or paid |
| **Vultr** | the image service box | ~$6/mo, MLH credits cover it |
| **.Tech domain** | `pledgecheck.tech` | MLH code, else ~$10 |
| **Tiger Data** | analytics warehouse | free tier |
| **Resend** | transactional email | free tier, 100/day |
| **ElevenLabs** | voice clips (one-off) | free tier |

Solana needs no account — a devnet keypair is generated locally and funded from a faucet.

---

## 2. Clone and install

```sh
git clone https://github.com/<owner>/PledgeCheck.git
cd PledgeCheck
npx --yes pnpm@10.34.5 install
```

**Trap:** `pnpm` is not installed globally on most machines and the repo pins a version.
Use `npx --yes pnpm@10.34.5` for every pnpm command, or `corepack enable` first. A
different pnpm version will rewrite the lockfile and cause a noisy diff.

Confirm the toolchain before going further:

```sh
npx --yes pnpm@10.34.5 test        # should pass, ~500 tests
npx --yes pnpm@10.34.5 typecheck
npx --yes pnpm@10.34.5 lint
```

---

## 3. Supabase

### 3.1 Create the project

Region **US East**. Save the database password somewhere real — you cannot read it back.

### 3.2 Run the SQL, in this order

SQL Editor, each file as one script:

1. `db/schema.sql` — tables
2. `db/policies.sql` — RLS, grants, the append-only audit trigger, storage bucket
3. `db/functions.sql` — `submit_review`
4. `db/audit.sql` — `audit_append`
5. `db/seed.sql` — **demo project only.** Creates four `@example.test` logins and
   synthetic patients. Never run it against real data.

**Trap — you cannot re-run these on a live database.** `schema.sql` is written as
`create table` and stops at the first table that already exists; `create policy` has no
`IF NOT EXISTS`. For an existing database use the idempotent patches in
`supabase/migrations/` instead. Write any future change as both: the source file, and a
patch that can be applied to a database that already exists.

### 3.3 Turn off email confirmation

Authentication → Sign In / Providers → Email → uncheck **Confirm email**.

Patients sign up and are enrolled by choosing a clinic; a signed-up account that is not
linked to a patient record can read nothing at all, so the email round-trip protects
nothing here. Verify it took:

```sh
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep autoconfirm
# mailer_autoconfirm: true   means confirmation is OFF
```

**If you leave it on**, set Authentication → URL Configuration → Site URL to a domain
that does **not** redirect. Supabase returns the session in a URL *fragment*, and a
fragment does not survive an HTTP redirect — the link will look broken with no error
anywhere. See §7.

### 3.4 Check the photo bucket is private

```sql
select public from storage.buckets where id = 'photos';  -- must be false
```

---

## 4. Environment variables

`.env.example` lists every name. Values live in Vercel and on the Vultr box, never in git.

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, service role. **Never** in a `NEXT_PUBLIC_*` |
| `XAI_API_KEY` | xAI console |
| `ANALYZE_URL` | `https://api.pledgecheck.tech` — **base URL, no `/analyze`** |
| `ANALYZE_SERVICE_KEY` | you invent it: `openssl rand -hex 32`, §8 |
| `TIGER_DATABASE_URL` | Tiger Data connection string |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` |
| `SOLANA_SECRET_KEY` | the JSON array from your devnet keypair, §9 |
| `RESEND_API_KEY` | Resend dashboard |
| `EMAIL_FROM` | `PledgeCheck <links@pledgecheck.tech>` — **angle brackets required** |

Only the two `NEXT_PUBLIC_*` values may appear in browser code.

**Trap — `ANALYZE_URL` takes no path.** The code appends `/analyze` itself. Adding it
gives you `/analyze/analyze` and 404s.

**Trap — `EMAIL_FROM` needs the angle brackets.** Without them Resend answers
`422: Invalid 'from' field` and the send silently reports `emailed: false`. Paste it
into Vercel unquoted; Vercel stores the literal string.

---

## 5. Run it locally

```sh
cp .env.example apps/web/.env.local     # fill in the values
npx --yes pnpm@10.34.5 dev
```

Sign in at `http://localhost:3000/login` with `prescriber1@example.test` and the dev
password in `README.md`.

**Trap — the camera needs a secure context.** `getUserMedia` only works on `https://` or
`localhost`. Testing the patient flow from your phone against your laptop's LAN address
will fail silently. Use a Vercel preview URL instead.

---

## 6. Vercel

1. Import the repo. **Root Directory: `apps/web`.** Framework preset: Next.js.
2. Settings → Environment Variables: add every name from §4 for Production and Preview.
3. Deploy.

**Trap — the CLI deploys your working copy, not git HEAD.** `vercel --prod` uploads
what is on disk. Check `git status` first.

**Trap — env changes need a redeploy.** Existing deployments keep the values they were
built with. Changing a variable does nothing until you deploy again.

---

## 7. Domain and DNS

Register `pledgecheck.tech`, then:

1. **Vercel → Settings → Domains** → add `pledgecheck.tech` and `www`. Vercel shows the
   exact records to create.
2. At your registrar's DNS manager, create **exactly those records**.
3. Add an `A` record, name `api`, pointing at your Vultr IPv4 (§8).

```sh
dig +short pledgecheck.tech          # must resolve
dig +short api.pledgecheck.tech      # must be the Vultr IP
curl -s -o /dev/null -w "%{http_code}" https://pledgecheck.tech/   # 200, not 302
```

**Trap — do not use registrar "domain forwarding".** It answers with a 302 to your
Vercel URL, which looks like it works and breaks three things at once:

- a URL **fragment** does not survive a redirect, so Supabase email confirmation loses
  its session token and the link appears broken with no error
- the address bar shows `vercel.app`, which undercuts a .Tech prize claim
- issued patient links point at a domain that may not resolve at all

A properly attached Vercel domain returns **200 directly**. A forward returns **302**.
That one digit is the whole difference.

---

## 8. Vultr image service

1. Deploy an instance: **Ubuntu 24.04 LTS**, smallest shared-CPU plan, region near your
   users. Under **SSH Keys**, click Add New and paste `~/.ssh/id_ed25519.pub`.
   *(No key? `ssh-keygen -t ed25519`. The `.pub` half is safe to paste anywhere; the
   other half never leaves your machine.)*
2. Note the public IPv4. Add the `api` DNS record from §7 **now** — Caddy requests its
   HTTPS certificate on boot and that only works once the name resolves.
3. Then:

```sh
ssh root@<VULTR_IP>
curl -fsSL https://get.docker.com | sh

ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

git clone https://github.com/<owner>/PledgeCheck.git pledgecheck
cd pledgecheck/apps/analyze
umask 077
echo "SERVICE_KEY=$(openssl rand -hex 32)" > .env
cat .env            # copy this once - it is ANALYZE_SERVICE_KEY in Vercel

docker compose up -d --build
docker compose ps           # api becomes "healthy" after ~30s
docker compose logs -f caddy   # watch the certificate issue
```

4. Put that `SERVICE_KEY` into Vercel as `ANALYZE_SERVICE_KEY`, set `ANALYZE_URL`, redeploy.

Verify from your laptop:

```sh
curl -i https://api.pledgecheck.tech/health
# 200 {"ok":true}

curl -i -X POST https://api.pledgecheck.tech/analyze -F image=@photo.jpg
# 401 - proves the key is enforced

curl -i -X POST https://api.pledgecheck.tech/analyze \
  -H "X-Service-Key: <SERVICE_KEY>" -F image=@photo.jpg
# 200 {"result","controlLine","testLine","confidence","phash"}
```

**Trap — a Vultr Firewall Group is separate from `ufw`.** If one is attached to the
instance it must also allow 80 and 443, or the ports stay closed no matter what `ufw`
says. Symptom: SSH works, HTTP times out.

**Trap — the reader ships uncalibrated.** `lines.py` has `CALIBRATED = False`, which
caps every confidence at 0.50 — below the 0.85 threshold — so every submission it reads
goes to manual review. That is deliberate. To change it you need real photos: put
labelled ones in `apps/analyze/tests/fixtures/photos/`, run
`pytest -q -s tests/test_real_photos.py`, tune the constants, then flip the flag. Until
then, say so out loud rather than claiming a validated detector.

---

## 9. Solana anchoring

The wallet is created by a person, never by code.

```sh
solana-keygen new --no-bip39-passphrase --outfile ~/devnet-anchor.json
solana airdrop 2 $(solana-keygen pubkey ~/devnet-anchor.json) --url devnet
# rate-limited? use https://faucet.solana.com with the public key
```

Set in Vercel:

- `SOLANA_RPC_URL=https://api.devnet.solana.com`
- `SOLANA_SECRET_KEY` = the contents of that file, a JSON array of 64 numbers

Never commit the wallet file. Delete it when the project ends; it only holds test SOL.

Verify by signing in and hitting **Anchor now** on `/audit`. An empty chain returns
`409 nothing_to_anchor` — which still proves the config is good, because a missing
variable returns `500 solana_not_configured` instead.

**Trap — `40001` is not a free-choice error code.** An earlier version of `audit_append`
raised SQLSTATE `40001` for a stale chain head. That is `serialization_failure`, which
PostgREST treats as retryable and retries *forever* for a condition that never clears.
Result: requests that never return, ~100 Postgres errors per second, and an exhausted
connection pool that took the whole REST API down. Conflicts now raise `PT409`, which is
PostgREST's convention for "respond 409". If you add your own conflict signal, do not
reuse a standard retryable class.

---

## 10. Resend email

1. Resend → **Domains** → add `pledgecheck.tech` → add the DKIM and SPF records it
   gives you at your registrar. Wait for verification.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` in Vercel. Redeploy.

To test before DNS verifies, use `EMAIL_FROM=PledgeCheck <onboarding@resend.dev>` — it
sends immediately but **only to the address that owns the Resend account.**

Email is best effort by design: if it fails, the link is still issued and returned so a
clinician can read it out. `emailed: false` in the response is the signal.

---

## 11. Tiger Data

Create a service, copy the connection string into `TIGER_DATABASE_URL`, then run
`db/tiger.sql` against it (hypertable, continuous aggregate, refresh policy).

**Trap — strip `?sslmode=require` from the URL.** Tiger serves a self-signed chain and
node-postgres escalates that parameter to `verify-full`, which overrides the explicit
`ssl` option next to it and kills the pool with `SELF_SIGNED_CERT_IN_CHAIN`. The code
already strips it; if you write a new client, do the same.

**Trap — a continuous aggregate needs `materialized_only = false`.** Without it, recent
data invisible until the refresh policy runs, and a demo shows an empty chart.

---

## 12. Generate the voice clips

One-off, from your laptop, never on Vercel:

```sh
ELEVENLABS_API_KEY=... npx --yes pnpm@10.34.5 --filter web gen-voice
```

Writes ten MP3s to `apps/web/public/audio/{en,es}/`. Commit them. They ship as static
files so the patient flow never waits on a live TTS call, and a demo works with no
ElevenLabs key present at all.

---

## 13. Prove it end to end

In order. Each step exercises something the previous one did not.

1. **Sign in** at `/login` as a clinician. Confirms Supabase auth and RLS.
2. **`/patients`** → toggle home testing on a patient → **Issue link**. Writes
   `patient.home_testing_changed` and `request.issued` to the audit chain.
3. **Open the link on a real phone.** Tap Start, write the code on the test, photograph
   it. Confirms HTTPS, camera capture, the session window and the challenge code.
4. **`/queue`** → the submission appears with both reads and any flags → approve.
   Confirms Grok, the image service, the rules engine and `submit_review`.
5. **`/windows`** → a 7-day window is open → **Mark filled.** Writes `window.filled`
   and the Tiger event.
6. **`/dashboard`** → the weekly chart has data. Confirms Tiger end to end.
7. **`/audit`** → **Verify** → `intact`. Then **Anchor now** → a devnet explorer link.

Step 3 is the one people skip and the one that matters: it is the only step that proves
the thing works on a phone, which is where every real patient will use it.

**Counts under 5 are hidden on the dashboard** (`SMALL_COUNT_FLOOR`), so an empty chart
after one run is correct behaviour, not a failure.

---

## 14. Things that look broken and are not

- **Every submission goes to manual review.** Expected while `CALIBRATED = False` (§8)
  and correct: nothing auto-approves.
- **A new patient cannot test at home.** `phase = 'pre'` and iPLEDGE rule 1 requires the
  first pre-treatment test in a medical setting. The rules engine is enforcing the law.
- **`/api/anchors` returns 409.** Nothing to anchor yet. Configuration is fine.
- **The dashboard is empty.** Counts under 5 are suppressed.
- **`audit_events` rejects a DELETE, even as service role.** An append-only trigger. To
  edit a row for a tamper demo, disable it deliberately and re-enable it after.
