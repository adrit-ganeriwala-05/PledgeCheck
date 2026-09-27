-- Row-level security, grants, audit immutability and photo storage.
-- Owner: Adrit. Run after schema.sql.
--
-- Model — two separate access paths that never overlap:
--   * A user with a `clinicians` row sees every row for that practice.
--   * A user with a `patients` row (portal signup) sees only their own clinical record,
--     and never audit_events or anchors.
--   * A user with neither (e.g. a future drug-maker login) sees nothing.
--   * Browser clients never insert, update or delete, with one exception: a patient may
--     insert their own refill_requests row. Everything else goes through server routes
--     using the service role; reviews only through POST /api/reviews and the
--     server-only public.submit_review function (db/functions.sql).

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Practice of the current user, or null when the user is not a clinician.
create or replace function app.current_practice_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.practice_id from public.clinicians c where c.id = auth.uid()
$$;

create or replace function app.is_prescriber()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinicians c where c.id = auth.uid() and c.role = 'prescriber'
  )
$$;

-- Patient row of the current user, or null when the user is not a portal patient.
-- The mirror of app.current_practice_id(), and the only thing that lets a patient read
-- their own clinical rows. A clinician has no patients row, so this is null for them,
-- and a patient has no clinicians row, so current_practice_id() is null for a patient:
-- the two access paths never overlap.
create or replace function app.current_patient_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.patients p where p.auth_user_id = auth.uid()
$$;

revoke all on function app.current_patient_id() from public;
grant execute on function app.current_patient_id() to authenticated, service_role;

revoke all on function app.current_practice_id() from public;
revoke all on function app.is_prescriber() from public;
grant execute on function app.current_practice_id() to authenticated, service_role;
grant execute on function app.is_prescriber() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges (RLS below narrows rows; these narrow operations)
-- ---------------------------------------------------------------------------

revoke all on
  public.practices, public.clinicians, public.patients, public.test_requests,
  public.submissions, public.reviews, public.windows, public.audit_events, public.anchors,
  public.refill_requests
from anon, authenticated;

grant select on
  public.practices, public.clinicians, public.patients, public.test_requests,
  public.submissions, public.reviews, public.windows, public.audit_events, public.anchors,
  public.refill_requests
to authenticated;

-- A patient may ask for a refill. Only that: every decision is a clinician's, made
-- through the service role, so no update or delete is granted to anyone here.
grant insert on public.refill_requests to authenticated;

revoke all on sequence public.audit_events_seq_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.practices     enable row level security;
alter table public.clinicians    enable row level security;
alter table public.patients      enable row level security;
alter table public.test_requests enable row level security;
alter table public.submissions   enable row level security;
alter table public.reviews       enable row level security;
alter table public.windows       enable row level security;
alter table public.audit_events  enable row level security;
alter table public.anchors       enable row level security;
alter table public.refill_requests enable row level security;

create policy practices_select on public.practices
  for select to authenticated
  using (id = app.current_practice_id());

create policy clinicians_select on public.clinicians
  for select to authenticated
  using (practice_id = app.current_practice_id());

create policy patients_select on public.patients
  for select to authenticated
  using (practice_id = app.current_practice_id());

create policy test_requests_select on public.test_requests
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = test_requests.patient_id
      and p.practice_id = app.current_practice_id()
  ));

create policy submissions_select on public.submissions
  for select to authenticated
  using (exists (
    select 1
    from public.test_requests r
    join public.patients p on p.id = r.patient_id
    where r.id = submissions.request_id
      and p.practice_id = app.current_practice_id()
  ));

create policy reviews_select on public.reviews
  for select to authenticated
  using (exists (
    select 1
    from public.submissions s
    join public.test_requests r on r.id = s.request_id
    join public.patients p on p.id = r.patient_id
    where s.id = reviews.submission_id
      and p.practice_id = app.current_practice_id()
  ));

create policy windows_select on public.windows
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = windows.patient_id
      and p.practice_id = app.current_practice_id()
  ));

-- audit_events has no practice column, so every clinician (of any practice) can read
-- every row. Clinicians only; users without a clinicians row see nothing.
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (app.current_practice_id() is not null);

create policy anchors_select on public.anchors
  for select to authenticated
  using (app.current_practice_id() is not null);

-- ---------------------------------------------------------------------------
-- Portal patients: a signed-in patient reads their own clinical record, and nothing
-- else. These sit alongside the clinician policies above; Postgres ORs permissive
-- policies, so a clinician still sees their practice and a patient still sees only
-- themselves. Neither can see the other's rows, because a clinician has no patients
-- row and a patient has no clinicians row.
--
-- Read-only throughout, with one exception: a patient may insert a refill request.
-- Every decision on it belongs to a clinician and is written by the service role.
-- Nothing here grants a patient access to audit_events or anchors.
-- ---------------------------------------------------------------------------

create policy patients_self_select on public.patients
  for select to authenticated
  using (id = app.current_patient_id());

create policy test_requests_patient_select on public.test_requests
  for select to authenticated
  using (patient_id = app.current_patient_id());

create policy submissions_patient_select on public.submissions
  for select to authenticated
  using (exists (
    select 1 from public.test_requests r
    where r.id = submissions.request_id
      and r.patient_id = app.current_patient_id()
  ));

create policy reviews_patient_select on public.reviews
  for select to authenticated
  using (exists (
    select 1
    from public.submissions s
    join public.test_requests r on r.id = s.request_id
    where s.id = reviews.submission_id
      and r.patient_id = app.current_patient_id()
  ));

create policy windows_patient_select on public.windows
  for select to authenticated
  using (patient_id = app.current_patient_id());

create policy refill_requests_select on public.refill_requests
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = refill_requests.patient_id
      and p.practice_id = app.current_practice_id()
  ));

create policy refill_requests_patient_select on public.refill_requests
  for select to authenticated
  using (patient_id = app.current_patient_id());

-- with check, not using: a patient may only ever file a request against their own row.
create policy refill_requests_patient_insert on public.refill_requests
  for insert to authenticated
  with check (patient_id = app.current_patient_id());

-- ---------------------------------------------------------------------------
-- audit_events is append-only, even for the service role
-- ---------------------------------------------------------------------------

create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function app.reject_audit_mutation();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Storage: private `photos` bucket, object path <practice_id>/<submission_id>.jpg
-- Clinicians read only their practice's folder. No client writes: uploads go through
-- the submissions route with the service role.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do update set public = false;

create policy photos_select_own_practice on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = app.current_practice_id()::text
  );
