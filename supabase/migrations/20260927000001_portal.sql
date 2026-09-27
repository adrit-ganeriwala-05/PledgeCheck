-- Patient portal, applied to a database that already has the base schema.
--
-- db/schema.sql is the source of truth and already contains everything below, but it is
-- written as `create table`, so re-running it against a live database stops at the first
-- table that exists. This patch is the same change expressed idempotently, for databases
-- that were created before the portal.
--
-- Safe to run more than once, and a no-op on a fresh `supabase db reset`, where
-- 20260926000001_schema.sql has already created these.

-- ---------------------------------------------------------------------------
-- Patient logins
-- ---------------------------------------------------------------------------

-- contact_email exists because staff email the one-time test link, which can happen
-- before the patient has ever signed up. The password is never here: Supabase Auth
-- holds it bcrypt-hashed in auth.users.
alter table public.patients add column if not exists contact_email text;
alter table public.patients add column if not exists auth_user_id uuid references auth.users (id);

-- Added separately so re-running does not fail on a duplicate constraint name.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'patients_auth_user_id_key'
  ) then
    alter table public.patients add constraint patients_auth_user_id_key unique (auth_user_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Refill requests
-- ---------------------------------------------------------------------------

create table if not exists public.refill_requests (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id),
  created_at      timestamptz not null default now(),
  status          text not null default 'requested'
                    check (status in ('requested', 'linked', 'declined')),
  test_request_id uuid references public.test_requests (id),
  decided_by      uuid references public.clinicians (id),
  decided_at      timestamptz,
  decline_reason  text
);

create index if not exists refill_requests_patient_idx
  on public.refill_requests (patient_id, created_at desc);
