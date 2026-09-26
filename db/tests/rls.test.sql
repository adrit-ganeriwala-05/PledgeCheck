-- RLS, grants, audit immutability and storage policy tests (pgTAP).
-- Run: npx supabase test db db/tests   (after `supabase start`)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). Fixed UUIDs keep assertions readable.
--   practice A: aaaa..., practice B: bbbb...
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'rx-a@example.test'),
  ('a0000000-0000-0000-0000-000000000002', 'staff-a@example.test'),
  ('b0000000-0000-0000-0000-000000000001', 'rx-b@example.test'),
  ('c0000000-0000-0000-0000-000000000001', 'nobody@example.test');

insert into public.practices (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Practice A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'Practice B');

insert into public.clinicians (id, practice_id, role, display_name) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'prescriber', 'Rx A'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'staff', 'Staff A'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000', 'prescriber', 'Rx B');

insert into public.patients (id, practice_id, pseudonym, can_get_pregnant, home_testing_allowed, phase) values
  ('a1000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'PT-A1', true, true, 'during'),
  ('b1000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-000000000000', 'PT-B1', true, true, 'during');

insert into public.test_requests (id, patient_id, token_hash, challenge_code, setting, expires_at, created_by) values
  ('a2000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', 'hash-a', 'K7Q2', 'home', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000000', 'hash-b', 'M3X9', 'home', now() + interval '1 day', 'b0000000-0000-0000-0000-000000000001');

insert into public.submissions (id, request_id, status) values
  ('a3000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000000', 'ready_for_review'),
  ('b3000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000000', 'ready_for_review');

insert into public.reviews (submission_id, clinician_id, decision) values
  ('b3000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'approved');

insert into public.windows (patient_id, submission_id, opens_at, closes_at) values
  ('a1000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', now(), now() + interval '7 days'),
  ('b1000000-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000000', now(), now() + interval '7 days');

insert into public.audit_events (actor, action, hash) values ('system', 'test.fixture', 'h1');
insert into public.anchors (head_seq, head_hash) select max(seq), 'h1' from public.audit_events;

insert into storage.objects (bucket_id, name) values
  ('photos', 'aaaaaaaa-0000-0000-0000-000000000000/a3000000-0000-0000-0000-000000000000.jpg'),
  ('photos', 'bbbbbbbb-0000-0000-0000-000000000000/b3000000-0000-0000-0000-000000000000.jpg');

-- Switch the session to an authenticated user (transaction-local).
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'photos'), false, 'photos bucket is private');

-- ---------------------------------------------------------------------------
-- Practice isolation: prescriber A sees only practice A
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');

select results_eq('select id from public.practices', $$values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid)$$, 'A sees only practice A');
select is((select count(*) from public.clinicians where practice_id <> 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint, 'A sees no practice B clinicians');
select results_eq('select pseudonym from public.patients', $$values ('PT-A1')$$, 'A sees only practice A patients');
select results_eq('select id from public.test_requests', $$values ('a2000000-0000-0000-0000-000000000000'::uuid)$$, 'A sees only practice A test_requests');
select results_eq('select id from public.submissions', $$values ('a3000000-0000-0000-0000-000000000000'::uuid)$$, 'A sees only practice A submissions');
select is((select count(*) from public.reviews), 0::bigint, 'A cannot see practice B review');
select is((select count(*) from public.windows where patient_id = 'b1000000-0000-0000-0000-000000000000'), 0::bigint, 'A cannot see practice B windows');
select is((select count(*) from public.windows), 1::bigint, 'A sees its own window');
select is((select count(*) from public.audit_events), 1::bigint, 'clinician can read audit_events');
select is((select count(*) from public.anchors), 1::bigint, 'clinician can read anchors');
select results_eq(
  $$select name from storage.objects where bucket_id = 'photos'$$,
  $$values ('aaaaaaaa-0000-0000-0000-000000000000/a3000000-0000-0000-0000-000000000000.jpg')$$,
  'A reads only its own practice folder in photos');

-- ---------------------------------------------------------------------------
-- Writes: no client writes except a prescriber's single review
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.submissions (request_id, status) values ('a2000000-0000-0000-0000-000000000000', 'needs_review')$$,
  '42501', null, 'client cannot insert submissions');
select throws_ok(
  $$update public.submissions set status = 'approved'$$,
  '42501', null, 'client cannot update submissions');
select throws_ok(
  $$insert into public.windows (patient_id, opens_at, closes_at) values ('a1000000-0000-0000-0000-000000000000', now(), now())$$,
  '42501', null, 'client cannot insert windows');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-0000-0000-000000000000/x.jpg')$$,
  '42501', null, 'client cannot upload photos');
select throws_ok(
  $$insert into public.reviews (submission_id, clinician_id, decision) values ('a3000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'approved')$$,
  '42501', null, 'prescriber cannot insert a review directly (only via POST /api/reviews)');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'prescriber cannot call submit_review directly');
select throws_ok($$update public.reviews set decision = 'rejected'$$, '42501', null, 'client cannot update reviews');
select throws_ok($$delete from public.reviews$$, '42501', null, 'client cannot delete reviews');
select throws_ok(
  $$insert into public.audit_events (actor, action, hash) values ('x', 'y', 'z')$$,
  '42501', null, 'client cannot insert audit_events');

-- ---------------------------------------------------------------------------
-- Staff: read-only, and no privilege escalation
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select is((select count(*) from public.patients), 1::bigint, 'staff can read own practice patients');
select throws_ok(
  $$insert into public.reviews (submission_id, clinician_id, decision) values ('a3000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'approved')$$,
  '42501', null, 'staff cannot insert a review');
select throws_ok(
  $$update public.clinicians set role = 'prescriber' where id = 'a0000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'staff cannot promote themselves to prescriber');
select throws_ok(
  $$update public.clinicians set practice_id = 'bbbbbbbb-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'staff cannot move themselves to another practice');
select throws_ok(
  $$insert into public.clinicians (id, practice_id, role, display_name) values ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'prescriber', 'x')$$,
  '42501', null, 'client cannot create clinicians');
select throws_ok(
  $$update public.patients set home_testing_allowed = true$$,
  '42501', null, 'client cannot change patients');
select throws_ok(
  $$update public.practices set name = 'x'$$,
  '42501', null, 'client cannot change practices');
select throws_ok(
  $$update public.test_requests set used_at = null$$,
  '42501', null, 'client cannot change test_requests');

-- ---------------------------------------------------------------------------
-- Authenticated user without a clinicians row sees nothing
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.act_as('c0000000-0000-0000-0000-000000000001');
select is((select count(*) from public.practices), 0::bigint, 'non-clinician: practices empty');
select is((select count(*) from public.clinicians), 0::bigint, 'non-clinician: clinicians empty');
select is((select count(*) from public.patients), 0::bigint, 'non-clinician: patients empty');
select is((select count(*) from public.test_requests), 0::bigint, 'non-clinician: test_requests empty');
select is((select count(*) from public.submissions), 0::bigint, 'non-clinician: submissions empty');
select is((select count(*) from public.reviews), 0::bigint, 'non-clinician: reviews empty');
select is((select count(*) from public.windows), 0::bigint, 'non-clinician: windows empty');
select is((select count(*) from public.audit_events), 0::bigint, 'non-clinician: audit_events empty');
select is((select count(*) from public.anchors), 0::bigint, 'non-clinician: anchors empty');
select is((select count(*) from storage.objects where bucket_id = 'photos'), 0::bigint, 'non-clinician: no photos');

-- ---------------------------------------------------------------------------
-- Anonymous role has no table access at all
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select count(*) from public.patients$$, '42501', null, 'anon cannot read patients');
select throws_ok($$select count(*) from public.audit_events$$, '42501', null, 'anon cannot read audit_events');

-- ---------------------------------------------------------------------------
-- audit_events is append-only, even for privileged roles
-- ---------------------------------------------------------------------------
reset role;
select throws_ok($$update public.audit_events set action = 'tampered'$$, '42501', null, 'UPDATE on audit_events raises (postgres)');
select throws_ok($$delete from public.audit_events$$, '42501', null, 'DELETE on audit_events raises (postgres)');
set local role service_role;
select throws_ok($$update public.audit_events set action = 'tampered'$$, '42501', null, 'UPDATE on audit_events raises (service_role)');
select throws_ok($$delete from public.audit_events$$, '42501', null, 'DELETE on audit_events raises (service_role)');
select lives_ok($$insert into public.audit_events (actor, action, hash) values ('system', 'test.append', 'h2')$$, 'service_role can append audit_events');
reset role;

select * from finish();
rollback;
