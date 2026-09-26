-- audit_append RPC tests (pgTAP).
-- Requires db/audit.sql to be applied (mirrored into supabase/migrations/).
-- Run: npx supabase test db db/tests   (after `supabase start`)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Hash values below are arbitrary 64-hex test vectors; the function does not recompute them.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.audit_append(1, repeat('0', 64), repeat('a', 64), 'system', 'window.missed', null, '{}', now())$$,
  '42501', null, 'anon cannot execute audit_append');
reset role;

set local role authenticated;
select throws_ok(
  $$select public.audit_append(1, repeat('0', 64), repeat('a', 64), 'system', 'window.missed', null, '{}', now())$$,
  '42501', null, 'authenticated cannot execute audit_append');
reset role;

set local role service_role;

-- ---------------------------------------------------------------------------
-- Empty table: seq 1 with the genesis prev_hash
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.audit_append(2, repeat('0', 64), repeat('a', 64), 'system', 'window.missed', null, '{}', now())$$,
  '40001', 'audit_chain_conflict', 'empty table rejects seq 2');

select throws_ok(
  $$select public.audit_append(1, repeat('f', 64), repeat('a', 64), 'system', 'window.missed', null, '{}', now())$$,
  '40001', 'audit_chain_conflict', 'empty table rejects a non-genesis prev_hash');

select is(
  public.audit_append(1, repeat('0', 64), repeat('a', 64), 'system', 'window.missed', null, '{}', now()),
  1::bigint, 'first append returns seq 1');

-- ---------------------------------------------------------------------------
-- Next append must chain onto the head
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.audit_append(2, repeat('0', 64), repeat('b', 64), 'system', 'window.missed', null, '{}', now())$$,
  '40001', 'audit_chain_conflict', 'stale prev_hash is rejected');

select throws_ok(
  $$select public.audit_append(3, repeat('a', 64), repeat('b', 64), 'system', 'window.missed', null, '{}', now())$$,
  '40001', 'audit_chain_conflict', 'skipped seq is rejected');

select throws_ok(
  $$select public.audit_append(1, repeat('a', 64), repeat('b', 64), 'system', 'window.missed', null, '{}', now())$$,
  '40001', 'audit_chain_conflict', 'repeated seq is rejected');

select throws_ok(
  $$select public.audit_append(2, repeat('a', 64), 'not-a-hash', 'system', 'window.missed', null, '{}', now())$$,
  '22023', null, 'malformed hash is rejected');

select is(
  public.audit_append(2, repeat('a', 64), repeat('b', 64), 'system', 'window.filled',
                      'a3000001-0000-0000-0000-000000000000', '{"decision":"approved"}', now()),
  2::bigint, 'second append returns seq 2');

select results_eq(
  $$select seq, prev_hash, hash from public.audit_events order by seq$$,
  $$values (1::bigint, repeat('0', 64), repeat('a', 64)), (2::bigint, repeat('a', 64), repeat('b', 64))$$,
  'rows are stored with the given seq and hashes');

select is(
  (select payload from public.audit_events where seq = 1), '{}'::jsonb, 'payload defaults to {}');

reset role;

select * from finish();
rollback;
