-- Row-level security, grants, audit immutability and photo storage.
-- Owner: Adrit. Run after schema.sql.
--
-- Model:
--   * A signed-in user sees rows only for the practice of their `clinicians` row.
--   * A signed-in user with no `clinicians` row (e.g. a future drug-maker login) sees nothing.
--   * Browser clients never insert/update/delete, except prescribers inserting one review.
--     All other writes go through server routes using the service role, or the review RPC.

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

revoke all on function app.current_practice_id() from public;
revoke all on function app.is_prescriber() from public;
grant execute on function app.current_practice_id() to authenticated, service_role;
grant execute on function app.is_prescriber() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges (RLS below narrows rows; these narrow operations)
-- ---------------------------------------------------------------------------

revoke all on
  public.practices, public.clinicians, public.patients, public.test_requests,
  public.submissions, public.reviews, public.windows, public.audit_events, public.anchors
from anon, authenticated;

grant select on
  public.practices, public.clinicians, public.patients, public.test_requests,
  public.submissions, public.reviews, public.windows, public.audit_events, public.anchors
to authenticated;

-- The only client-side write: a prescriber recording a review. No UPDATE or DELETE.
grant insert on public.reviews to authenticated;

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

create policy reviews_insert_prescriber on public.reviews
  for insert to authenticated
  with check (
    app.is_prescriber()
    and clinician_id = auth.uid()
    and exists (
      select 1
      from public.submissions s
      join public.test_requests r on r.id = s.request_id
      join public.patients p on p.id = r.patient_id
      where s.id = reviews.submission_id
        and p.practice_id = app.current_practice_id()
    )
  );

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
