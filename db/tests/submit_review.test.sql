-- submit_review RPC tests (pgTAP).
-- Run: npx supabase test db db/tests   (after `supabase start`)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

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
  ('a1000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', 'PT-A1', true, true, 'during');

-- Six practice A submissions: 1 approve+window, 2 approve no window, 3 reject,
-- 4 awaiting_photo, 5 pre-existing review (inconsistent state), 6 needs_review.
insert into public.test_requests (id, patient_id, token_hash, challenge_code, setting, expires_at, created_by)
select ('a200000' || n || '-0000-0000-0000-000000000000')::uuid, 'a1000000-0000-0000-0000-000000000000',
       'hash-' || n, 'K7Q' || n, 'home', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000001'
from generate_series(1, 6) n;

insert into public.submissions (id, request_id, status) values
  ('a3000001-0000-0000-0000-000000000000', 'a2000001-0000-0000-0000-000000000000', 'ready_for_review'),
  ('a3000002-0000-0000-0000-000000000000', 'a2000002-0000-0000-0000-000000000000', 'ready_for_review'),
  ('a3000003-0000-0000-0000-000000000000', 'a2000003-0000-0000-0000-000000000000', 'needs_review'),
  ('a3000004-0000-0000-0000-000000000000', 'a2000004-0000-0000-0000-000000000000', 'awaiting_photo'),
  ('a3000005-0000-0000-0000-000000000000', 'a2000005-0000-0000-0000-000000000000', 'ready_for_review'),
  ('a3000006-0000-0000-0000-000000000000', 'a2000006-0000-0000-0000-000000000000', 'needs_review');

insert into public.reviews (submission_id, clinician_id, decision) values
  ('a3000005-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'approved');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- Only the server (service_role) may execute submit_review
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'anon cannot execute submit_review');
reset role;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'a signed-in prescriber cannot execute submit_review directly');
reset role;

-- ---------------------------------------------------------------------------
-- The function re-checks the clinician id the route passes in
-- ---------------------------------------------------------------------------
set local role service_role;
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000002', 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'staff cannot review');
select throws_ok(
  $$select public.submit_review('c0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'user without clinicians row cannot review');
select throws_ok(
  $$select public.submit_review('b0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'prescriber of another practice cannot review');
select throws_ok(
  $$select public.submit_review(null, 'a3000001-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '42501', null, 'missing clinician id cannot review');

-- ---------------------------------------------------------------------------
-- Prescriber A (through the server)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000000', 'approved', null, null)$$,
  'P0002', null, 'unknown submission raises P0002');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'maybe', null, null)$$,
  '22023', null, 'invalid decision raises 22023');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, '{"opens_at": "2026-09-26T15:00:00Z"}')$$,
  '22023', null, 'window without closes_at raises 22023');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, '{"opens_at": "2026-10-03T15:00:00Z", "closes_at": "2026-09-26T15:00:00Z"}')$$,
  '22023', null, 'window closing before it opens raises 22023');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null, '{"opens_at": "2026-09-26T15:00:00Z", "closes_at": "2026-09-26T15:00:00Z"}')$$,
  '22023', null, 'zero-length window raises 22023');

select is(
  public.submit_review(
    'a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'approved', null,
    '{"opens_at": "2026-09-26T15:00:00Z", "closes_at": "2026-10-03T15:00:00Z", "is_first_rx": true}'
  ),
  jsonb_build_object('status', 'approved', 'window', jsonb_build_object(
    'opens_at', '2026-09-26T15:00:00Z'::timestamptz,
    'closes_at', '2026-10-03T15:00:00Z'::timestamptz,
    'is_first_rx', true)),
  'approve with window returns status and window');

select is(
  public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000002-0000-0000-0000-000000000000', 'approved', null, null),
  '{"status": "approved", "window": null}'::jsonb,
  'approve without window returns window null');

select is(
  public.submit_review(
    'a0000000-0000-0000-0000-000000000001', 'a3000003-0000-0000-0000-000000000000', 'rejected', 'Test line unclear',
    '{"opens_at": "2026-09-26T15:00:00Z", "closes_at": "2026-10-03T15:00:00Z"}'
  ),
  '{"status": "rejected", "window": null}'::jsonb,
  'reject ignores any window');

select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000001-0000-0000-0000-000000000000', 'rejected', 'x', null)$$,
  'PC409', null, 'already-decided submission raises PC409');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000004-0000-0000-0000-000000000000', 'approved', null, null)$$,
  'PC409', null, 'awaiting_photo submission raises PC409');
select throws_ok(
  $$select public.submit_review('a0000000-0000-0000-0000-000000000001', 'a3000005-0000-0000-0000-000000000000', 'approved', null, null)$$,
  '23505', null, 'duplicate review raises 23505');

reset role;

-- ---------------------------------------------------------------------------
-- Side effects (as postgres)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id::text, status from public.submissions where id::text like 'a300000%' order by id$$,
  $$values
    ('a3000001-0000-0000-0000-000000000000', 'approved'),
    ('a3000002-0000-0000-0000-000000000000', 'approved'),
    ('a3000003-0000-0000-0000-000000000000', 'rejected'),
    ('a3000004-0000-0000-0000-000000000000', 'awaiting_photo'),
    ('a3000005-0000-0000-0000-000000000000', 'ready_for_review'),
    ('a3000006-0000-0000-0000-000000000000', 'needs_review')$$,
  'statuses updated only for successful reviews');

select results_eq(
  $$select submission_id::text, clinician_id::text, decision, reason from public.reviews where submission_id::text like $q$a300000%$q$ order by submission_id$$,
  $$values
    ('a3000001-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'approved', null::text),
    ('a3000002-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'approved', null::text),
    ('a3000003-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'rejected', 'Test line unclear'),
    ('a3000005-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'approved', null::text)$$,
  'review rows recorded with the caller as clinician');

select results_eq(
  $$select patient_id::text, submission_id::text, is_first_rx, opens_at, closes_at, status from public.windows where patient_id = 'a1000000-0000-0000-0000-000000000000'$$,
  $$values ('a1000000-0000-0000-0000-000000000000', 'a3000001-0000-0000-0000-000000000000', true,
            '2026-09-26T15:00:00Z'::timestamptz, '2026-10-03T15:00:00Z'::timestamptz, 'open')$$,
  'exactly one open window, with the dates passed in');

select * from finish();
rollback;
