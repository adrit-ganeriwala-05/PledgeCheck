# Deploying PledgeCheck

Manual steps for a human. Nothing here has been run yet; each step says how to verify it.
Replace every `<PLACEHOLDER>` with the real value. Never commit a real key or `.env` file.

| Piece | Host | URL |
|---|---|---|
| Next.js app and API | Vercel | `https://pledgecheck.tech` |
| Image service (`apps/analyze`) | Vultr + Docker + Caddy | `https://api.pledgecheck.tech` |
| Database, auth, photo storage | Supabase | project URL |

## 1. Claim the MLH codes

1. Redeem the MLH codes for **.Tech** and **Vultr** from the MLH prizes page.
2. Register `pledgecheck.tech` with the .Tech code.
   **If `pledgecheck.tech` is taken, stop and ask the team. Do not pick another name on your own**;
   the domain appears in the Caddyfile, this doc and the Devpost write-up.
3. Confirm the Vultr credits show in the Vultr billing page.

## 2. Vercel

1. Import the GitHub repo into Vercel. Set **Root Directory** to `apps/web`
   (framework preset: Next.js; install and build commands left as default).
2. In Project → Settings → Environment Variables, add each name below for Production and Preview.
   Values come from their owners; the list matches `.env.example`.

   | Name | Owner | Where the value comes from |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Adrit | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Adrit | Supabase → Project Settings → API (anon / publishable key) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Adrit | Supabase → Project Settings → API (service role / secret key) |
   | `XAI_API_KEY` | Labib | xAI console (SpaceXAI credits) |
   | `ANALYZE_URL` | Adrit | `https://api.pledgecheck.tech` |
   | `ANALYZE_SERVICE_KEY` | Adrit | Same value as `SERVICE_KEY` on Vultr (step 5) |
   | `TIGER_DATABASE_URL` | Labib | Tiger Data service connection string |
   | `SOLANA_RPC_URL` | Nihalika | Devnet RPC URL |
   | `SOLANA_SECRET_KEY` | Nihalika | Devnet keypair (test SOL only) |

   Only the two `NEXT_PUBLIC_*` values are allowed in browser code.
3. Project → Settings → Domains: add `pledgecheck.tech` (and `www.pledgecheck.tech` if offered).
   Keep this screen open for step 3.

## 3. DNS at get.tech

In the get.tech DNS manager for `pledgecheck.tech`:

1. **Apex and `www`**: create exactly the records Vercel's Domains screen shows
   (record type, name and value). Do not copy values from anywhere else.
2. **Image service**: add an `A` record with name `api` pointing to `<VULTR_IP>`
   (the instance's public IPv4 from step 4).
3. Verify (DNS can take a few minutes):
   ```sh
   dig +short pledgecheck.tech
   dig +short api.pledgecheck.tech      # must print <VULTR_IP>
   ```
   Vercel's Domains screen should show the domain as valid.

## 4. Vultr instance

1. Create an instance: **Ubuntu 24.04 LTS**, smallest regular plan is enough, region near Atlanta.
   Add your SSH key. Note the public IPv4 as `<VULTR_IP>`.
2. SSH in and install Docker (official script):
   ```sh
   ssh root@<VULTR_IP>
   curl -fsSL https://get.docker.com | sh
   docker compose version
   ```
3. Firewall: allow only 22, 80 and 443.
   ```sh
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw --force enable
   ufw status
   ```
   Docker-published ports bypass `ufw`. Only Caddy publishes ports (80, 443) and the API
   is not published, so this is safe; also create a Vultr **Firewall Group** with the same
   three rules and attach it to the instance for a second layer.

## 5. Run the image service

On the Vultr instance:

```sh
git clone <REPO_URL> pledgecheck
cd pledgecheck/apps/analyze
umask 077
echo "SERVICE_KEY=$(openssl rand -hex 32)" > .env
cat .env                                  # copy the value once, then clear your terminal
docker compose up -d --build
docker compose ps                         # api should become "healthy"
```

Set the same value as `ANALYZE_SERVICE_KEY` in Vercel (step 2), then redeploy Vercel so it
picks up the variable. Do not paste the key into chat, commits or screenshots.

Caddy requests the HTTPS certificate automatically once `api.pledgecheck.tech` resolves to
the instance and ports 80/443 are open. Watch it with `docker compose logs -f caddy`.

## 6. Verify the image service

From your laptop:

```sh
# 1. Health, no auth: expect 200 and {"ok":true}
curl -i https://api.pledgecheck.tech/health

# 2. No key: expect 401 {"error":"..."}
curl -i -X POST https://api.pledgecheck.tech/analyze -F image=@<REAL_TEST_PHOTO>.jpg

# 3. With the key and a real photo from the team's test: expect 200 and exactly
#    {"result","controlLine","testLine","confidence","phash"}
curl -i -X POST https://api.pledgecheck.tech/analyze \
  -H "X-Service-Key: <SERVICE_KEY>" \
  -F image=@<REAL_TEST_PHOTO>.jpg
```

Checks 2 and 3 need ticket A4 (`POST /analyze`) deployed. Record the actual results in the
team chat; do not mark this step done from memory.

## 7. Fallback if HTTPS fails

If `https://api.pledgecheck.tech/health` still fails **one hour** after DNS points at the
instance, **tell the team before switching to Railway.** Moving the service off Vultr loses
the Vultr prize, so it is a team decision (PRD cut order, item 5).

Useful checks first: `dig +short api.pledgecheck.tech`, `ufw status`,
`docker compose logs caddy`, and that nothing else is bound to ports 80/443.

## 8. Supabase

1. Create a Supabase project (region: US East). Save the database password in a password
   manager, not in the repo.
2. In the SQL editor, run these files **in order**, each as one script:
   1. `db/schema.sql`
   2. `db/policies.sql`
   3. `db/functions.sql`
   4. `db/seed.sql`, **dev/demo project only**. It creates the four `@example.test`
      logins and synthetic patients. Never run it on a project with real data.
3. Confirm the `photos` bucket is private: Storage → `photos` → the bucket must not be marked
   Public. Or in SQL: `select public from storage.buckets where id = 'photos';` → `false`.
4. Authentication → URL Configuration: set Site URL to `https://pledgecheck.tech`.
5. Copy the project URL, anon key and service role key into Vercel (step 2).
6. Verify with a dev login (see README) on the deployed site once the clinic screens exist.

Note for the audit tamper demo: `audit_events` has a trigger that blocks UPDATE and DELETE,
even from the SQL editor. To edit a row on purpose for the demo, run
`alter table public.audit_events disable trigger audit_events_no_update_delete;`, make the
edit, then `alter table public.audit_events enable trigger audit_events_no_update_delete;`.
