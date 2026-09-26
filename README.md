# PledgeCheck

At-home iPLEDGE pregnancy tests with fraud checks, two independent reads (Grok vision and
an OpenCV service) and a dermatologist's decision on every result. All patient data in this
repo is synthetic.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js app (Vercel, root directory `apps/web`) |
| `apps/analyze` | FastAPI image service (Vultr) |
| `db/` | Supabase schema, policies, functions, seed and pgTAP tests (source of truth) |
| `supabase/` | Local Supabase CLI config; `migrations/` mirrors `db/*.sql` |

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

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
`npx supabase@2.118.0 test db db/tests` for the database.

### Dev logins (local seed only)

| Email | Role | Practice |
|---|---|---|
| `prescriber1@example.test` | prescriber | Demo Dermatology North |
| `staff1@example.test` | staff | Demo Dermatology North |
| `prescriber2@example.test` | prescriber | Demo Dermatology South |
| `staff2@example.test` | staff | Demo Dermatology South |

Password for all four: `pledgecheck-dev`. These accounts exist only in the local seed; never
run `db/seed.sql` against a project holding real data.
