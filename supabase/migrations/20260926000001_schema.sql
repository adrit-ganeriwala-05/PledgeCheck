-- PledgeCheck schema: the nine-table contract the whole team builds against.
-- Owner: Adrit. Post any change in the team chat before merging.
--
-- Apply order: schema.sql, policies.sql, functions.sql, then seed.sql (local dev only).
-- All patients are synthetic. Never add name, date of birth, SSN or other identifying fields.

create table public.practices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.clinicians (
  id           uuid primary key references auth.users (id),
  practice_id  uuid not null references public.practices (id),
  role         text not null check (role in ('prescriber', 'staff')),
  display_name text not null
);

-- contact_email and auth_user_id are the only patient identifiers in this schema; the
-- pseudonym stays the label shown on every clinic screen. contact_email exists because
-- staff email the one-time test link, which may happen before the patient ever signs up.
-- The password is never here: Supabase Auth holds it, bcrypt-hashed, in auth.users.
create table public.patients (
  id                   uuid primary key default gen_random_uuid(),
  practice_id          uuid not null references public.practices (id),
  pseudonym            text not null,
  contact_email        text,
  auth_user_id         uuid unique references auth.users (id),
  can_get_pregnant     boolean not null,
  home_testing_allowed boolean not null default false,
  phase                text not null check (phase in ('pre', 'during', 'after', 'complete')),
  treatment_start      date,
  language             text not null default 'en' check (language in ('en', 'es'))
);

create table public.test_requests (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients (id),
  token_hash     text not null unique,
  challenge_code char(4) not null,
  setting        text not null check (setting in ('home', 'clinic')),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_by     uuid not null references public.clinicians (id)
);

-- Photo and read columns are nullable: the row may be created when the link is issued
-- (status awaiting_photo) or at capture; that decision is still open.
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references public.test_requests (id),
  photo_path      text,
  phash           text,
  captured_at     timestamptz,
  grok_result     text,
  grok_code       text,
  grok_confidence numeric,
  cv_result       text,
  cv_confidence   numeric,
  flags           text[] not null default '{}',
  status          text not null check (status in (
                    'awaiting_photo', 'rejected_fraud', 'needs_review', 'ready_for_review',
                    'approved', 'rejected', 'expired'))
);

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id),
  clinician_id  uuid not null references public.clinicians (id),
  decision      text not null check (decision in ('approved', 'rejected')),
  reason        text,
  decided_at    timestamptz not null default now()
);

create table public.windows (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients (id),
  submission_id uuid references public.submissions (id),
  is_first_rx   boolean not null default false,
  opens_at      timestamptz not null,
  closes_at     timestamptz not null,
  filled_at     timestamptz,
  status        text not null default 'open' check (status in ('open', 'filled', 'missed'))
);

-- Append-only; see policies.sql for the trigger that blocks UPDATE and DELETE.
-- Hashing is done by the audit module (Nihalika), not in the database.
-- Patient-initiated request to start a refill cycle. Owner: Labib.
--
-- This table holds only what is new: who asked, when, and what staff decided. It stores no
-- copy of the test outcome. Once test_request_id is set, the existing pipeline
-- (test_requests -> submissions -> reviews -> windows) is the single source of truth for
-- what happened, and the portal derives the patient-facing status by reading it. A second
-- status column here would be a second truth, and they would drift.
--
-- The decision is always a clinician's: a patient can create a row and nothing else.
create table public.refill_requests (
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

create index refill_requests_patient_idx on public.refill_requests (patient_id, created_at desc);

create table public.audit_events (
  seq        bigserial primary key,
  actor      text not null,
  action     text not null,
  ref_id     uuid,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  prev_hash  text,
  hash       text not null
);

create table public.anchors (
  id               uuid primary key default gen_random_uuid(),
  head_seq         bigint not null references public.audit_events (seq),
  head_hash        text not null,
  solana_signature text,
  cluster          text not null default 'devnet',
  created_at       timestamptz not null default now()
);

create index submissions_status_idx on public.submissions (status);
create index test_requests_patient_id_idx on public.test_requests (patient_id);
create index windows_patient_id_status_idx on public.windows (patient_id, status);
create index patients_practice_id_idx on public.patients (practice_id);
