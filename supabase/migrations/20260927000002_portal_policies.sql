-- Patient portal RLS, applied to a database that already has the base policies.
--
-- The companion to 20260927000001_portal.sql. db/policies.sql is the source of truth and
-- already contains all of this, but `create policy` has no IF NOT EXISTS, so re-running
-- it against a live database stops at the first policy that exists. Each policy here is
-- dropped first, which makes the file safe to run repeatedly.
--
-- Nothing below touches an existing clinician policy. Postgres ORs permissive policies,
-- so adding these leaves clinic access exactly as it was.

-- ---------------------------------------------------------------------------
-- Who the current user is, patient side
-- ---------------------------------------------------------------------------

-- Mirror of app.current_practice_id(). The two never overlap: a clinician has no
-- patients row and a patient has no clinicians row, so each is null for the other.
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

-- ---------------------------------------------------------------------------
-- Privileges on the new table
-- ---------------------------------------------------------------------------

revoke all on public.refill_requests from anon, authenticated;
grant select on public.refill_requests to authenticated;

-- A patient may ask for a refill. Only that: every decision is a clinician's, made
-- through the service role, so no update or delete is granted to anyone here.
grant insert on public.refill_requests to authenticated;

alter table public.refill_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Patient self-access. Read-only everywhere except their own refill request.
-- No access to audit_events or anchors is granted at any point.
-- ---------------------------------------------------------------------------

drop policy if exists patients_self_select on public.patients;
create policy patients_self_select on public.patients
  for select to authenticated
  using (id = app.current_patient_id());

drop policy if exists test_requests_patient_select on public.test_requests;
create policy test_requests_patient_select on public.test_requests
  for select to authenticated
  using (patient_id = app.current_patient_id());

drop policy if exists submissions_patient_select on public.submissions;
create policy submissions_patient_select on public.submissions
  for select to authenticated
  using (exists (
    select 1 from public.test_requests r
    where r.id = submissions.request_id
      and r.patient_id = app.current_patient_id()
  ));

drop policy if exists reviews_patient_select on public.reviews;
create policy reviews_patient_select on public.reviews
  for select to authenticated
  using (exists (
    select 1
    from public.submissions s
    join public.test_requests r on r.id = s.request_id
    where s.id = reviews.submission_id
      and r.patient_id = app.current_patient_id()
  ));

drop policy if exists windows_patient_select on public.windows;
create policy windows_patient_select on public.windows
  for select to authenticated
  using (patient_id = app.current_patient_id());

-- ---------------------------------------------------------------------------
-- Refill requests: clinicians see their practice's, patients see their own.
-- ---------------------------------------------------------------------------

drop policy if exists refill_requests_select on public.refill_requests;
create policy refill_requests_select on public.refill_requests
  for select to authenticated
  using (exists (
    select 1 from public.patients p
    where p.id = refill_requests.patient_id
      and p.practice_id = app.current_practice_id()
  ));

drop policy if exists refill_requests_patient_select on public.refill_requests;
create policy refill_requests_patient_select on public.refill_requests
  for select to authenticated
  using (patient_id = app.current_patient_id());

-- with check, not using: a patient may only ever file a request against their own row.
drop policy if exists refill_requests_patient_insert on public.refill_requests;
create policy refill_requests_patient_insert on public.refill_requests
  for insert to authenticated
  with check (patient_id = app.current_patient_id());
