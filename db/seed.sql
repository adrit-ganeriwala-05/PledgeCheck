-- Synthetic seed data for LOCAL DEVELOPMENT ONLY. Never run against a real practice.
-- Every patient is fictional (pseudonyms only). No names, dates of birth or SSNs.
--
-- Logins: 4 clinicians with @example.test emails; the shared dev password is in README.md
-- (only its bcrypt hash is stored here).
--
-- Per practice, for queue development:
--   2 ready_for_review (readers agree, confidence >= 0.85)
--   2 needs_review     (one disagreement, one low confidence)
--   1 rejected_fraud, 1 approved with an open window, 1 awaiting_photo
-- photo_path points at objects that do not exist; the queue shows "photo unavailable".
-- No test photos are generated.

-- ---------------------------------------------------------------------------
-- Auth users (local GoTrue needs the empty-string token columns and an identity row)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  '$2a$10$8oNOta/xHaw7MW7dpjQlo.x2GRT.ljuLjnTqzC9hEp/YUdTaYs98e', now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('11111111-0000-0000-0000-000000000001'::uuid, 'prescriber1@example.test'),
  ('11111111-0000-0000-0000-000000000002'::uuid, 'staff1@example.test'),
  ('22222222-0000-0000-0000-000000000001'::uuid, 'prescriber2@example.test'),
  ('22222222-0000-0000-0000-000000000002'::uuid, 'staff2@example.test')
) as u (id, email);

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test';

-- ---------------------------------------------------------------------------
-- Practices and clinicians
-- ---------------------------------------------------------------------------
insert into public.practices (id, name) values
  ('10000000-0000-0000-0000-000000000000', 'Demo Dermatology North'),
  ('20000000-0000-0000-0000-000000000000', 'Demo Dermatology South');

insert into public.clinicians (id, practice_id, role, display_name) values
  ('11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000', 'prescriber', 'Dr. Demo North'),
  ('11111111-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000', 'staff', 'Staff Demo North'),
  ('22222222-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000000', 'prescriber', 'Dr. Demo South'),
  ('22222222-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000000', 'staff', 'Staff Demo South');

-- ---------------------------------------------------------------------------
-- Patients: 6 per practice across phases. Patient ids: <practice digit>1000000-...-00000000000<n>
-- ---------------------------------------------------------------------------
insert into public.patients (id, practice_id, pseudonym, can_get_pregnant, home_testing_allowed, phase, treatment_start, language)
values
  -- North
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000000', 'PT-1042', true,  true,  'during',   current_date - 60,  'en'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000000', 'PT-1057', true,  true,  'during',   current_date - 95,  'es'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000000', 'PT-1063', true,  true,  'after',    current_date - 170, 'en'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000000', 'PT-1071', true,  false, 'pre',      null,               'en'),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000000', 'PT-1088', false, false, 'during',   current_date - 40,  'es'),
  ('11000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000000', 'PT-1094', true,  true,  'complete', current_date - 200, 'en'),
  -- South
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000000', 'PT-2013', true,  true,  'during',   current_date - 30,  'en'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000000', 'PT-2026', true,  true,  'during',   current_date - 120, 'es'),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000000', 'PT-2031', true,  true,  'after',    current_date - 150, 'en'),
  ('21000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000000', 'PT-2045', true,  false, 'pre',      null,               'es'),
  ('21000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000000', 'PT-2058', false, false, 'during',   current_date - 75,  'en'),
  ('21000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000000', 'PT-2067', true,  true,  'during',   current_date - 10,  'en');

-- ---------------------------------------------------------------------------
-- Test requests and submissions: 7 scenarios per practice
-- ---------------------------------------------------------------------------
create temporary table seed_scenarios (
  n int primary key,
  patient_n int not null,
  status text not null,
  grok_result text,
  grok_code_ok boolean,
  grok_confidence numeric,
  cv_result text,
  cv_confidence numeric,
  flags text[] not null,
  captured_ago interval
);

insert into seed_scenarios values
  (1, 1, 'ready_for_review', 'negative', true,  0.94, 'negative', 0.91, '{}',                 interval '2 hours'),
  (2, 2, 'ready_for_review', 'negative', true,  0.90, 'negative', 0.87, '{}',                 interval '5 hours'),
  (3, 3, 'needs_review',     'negative', true,  0.92, 'positive', 0.88, '{readers_disagree}',  interval '3 hours'),
  (4, 6, 'needs_review',     'negative', true,  0.62, 'negative', 0.50, '{low_confidence}',   interval '1 hour'),
  (5, 1, 'rejected_fraud',   'negative', false, 0.89, 'negative', 0.86, '{code_mismatch}',    interval '26 hours'),
  (6, 2, 'approved',         'negative', true,  0.95, 'negative', 0.93, '{}',                 interval '30 hours'),
  (7, 3, 'awaiting_photo',   null,       null,  null,  null,       null, '{}',                 null);

create temporary table seed_practices (digit text primary key, practice_id uuid, prescriber_id uuid);
insert into seed_practices values
  ('1', '10000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000001'),
  ('2', '20000000-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000001');

-- Request id: <d>2000000-0000-0000-0000-00000000000<n>; submission id: <d>3000000-...-<n>
insert into public.test_requests (id, patient_id, token_hash, challenge_code, setting, expires_at, used_at, created_by)
select
  (p.digit || '2000000-0000-0000-0000-00000000000' || s.n)::uuid,
  (p.digit || '1000000-0000-0000-0000-00000000000' || s.patient_n)::uuid,
  encode(extensions.digest('seed-token-' || p.digit || '-' || s.n, 'sha256'), 'hex'),
  (array['K7Q2', 'M3X9', 'T4P8', 'R2W6', 'H9D3', 'B5N7', 'F8L4'])[s.n],
  'home',
  case when s.status = 'awaiting_photo' then now() + interval '20 hours'
       else now() - s.captured_ago + interval '24 hours' end,
  case when s.status = 'awaiting_photo' then null else now() - s.captured_ago end,
  p.prescriber_id
from seed_scenarios s cross join seed_practices p;

insert into public.submissions (
  id, request_id, photo_path, phash, captured_at,
  grok_result, grok_code, grok_confidence, cv_result, cv_confidence, flags, status
)
select
  (p.digit || '3000000-0000-0000-0000-00000000000' || s.n)::uuid,
  r.id,
  case when s.status in ('awaiting_photo', 'approved') then null  -- approved photos are deleted after review
       else p.practice_id || '/' || p.digit || '3000000-0000-0000-0000-00000000000' || s.n || '.jpg' end,
  case when s.status = 'awaiting_photo' then null
       else substr(md5('seed-phash-' || p.digit || '-' || s.n), 1, 16) end,
  now() - s.captured_ago,
  s.grok_result,
  case when s.grok_code_ok is null then null
       when s.grok_code_ok then r.challenge_code
       else 'X0X0' end,
  s.grok_confidence,
  s.cv_result,
  s.cv_confidence,
  s.flags,
  s.status
from seed_scenarios s
cross join seed_practices p
join public.test_requests r on r.id = (p.digit || '2000000-0000-0000-0000-00000000000' || s.n)::uuid;

-- The approved submission has its review and an open 7-day window (fixture dates only).
insert into public.reviews (submission_id, clinician_id, decision, decided_at)
select (p.digit || '3000000-0000-0000-0000-000000000006')::uuid, p.prescriber_id, 'approved', now() - interval '29 hours'
from seed_practices p;

insert into public.windows (patient_id, submission_id, is_first_rx, opens_at, closes_at, status)
select (p.digit || '1000000-0000-0000-0000-000000000002')::uuid,
       (p.digit || '3000000-0000-0000-0000-000000000006')::uuid,
       false,
       now() - interval '29 hours',
       now() - interval '29 hours' + interval '7 days',
       'open'
from seed_practices p;

drop table seed_scenarios;
drop table seed_practices;
