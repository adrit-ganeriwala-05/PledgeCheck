-- Audit chain database functions. Owner: Nihalika. Run after schema.sql, policies.sql
-- and functions.sql. Adds functions and grants only; alters no table, policy or trigger.

-- ---------------------------------------------------------------------------
-- audit_append: insert one hash-chained audit event, serialized across writers.
--
-- All inserts into audit_events go through this function with an explicit seq, so the
-- bigserial default (audit_events_seq_seq) is never used.
--
-- The caller (apps/web/lib/audit/append.ts) reads the head, computes the hash in
-- TypeScript and passes it in. This function computes no hashes, so the writer and the
-- verifier share one implementation. Under a transaction-scoped advisory lock it checks
-- that the caller's view of the head is still current:
--   p_seq       must equal head seq + 1   (1 when the table is empty)
--   p_prev_hash must equal head hash      (64 zeros when the table is empty)
-- Otherwise it raises SQLSTATE 40001 'audit_chain_conflict' and the caller retries.
--
-- Error codes:
--   40001  audit_chain_conflict (stale head; retry)
--   22023  malformed hash
-- Returns the inserted seq.
-- ---------------------------------------------------------------------------
create or replace function public.audit_append(
  p_seq bigint,
  p_prev_hash text,
  p_hash text,
  p_actor text,
  p_action text,
  p_ref_id uuid,
  p_payload jsonb,
  p_created_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head_seq bigint;
  v_head_hash text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or p_prev_hash is null or p_prev_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'audit_append: malformed hash' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('audit_events_chain'));

  select e.seq, e.hash into v_head_seq, v_head_hash
  from public.audit_events e
  order by e.seq desc
  limit 1;

  if not found then
    v_head_seq := 0;
    v_head_hash := repeat('0', 64);
  end if;

  if p_seq is distinct from v_head_seq + 1 or p_prev_hash is distinct from v_head_hash then
    raise exception 'audit_chain_conflict' using errcode = '40001';
  end if;

  insert into public.audit_events (seq, actor, action, ref_id, payload, created_at, prev_hash, hash)
  values (p_seq, p_actor, p_action, p_ref_id, coalesce(p_payload, '{}'::jsonb), p_created_at, p_prev_hash, p_hash);

  return p_seq;
end;
$$;

revoke all on function public.audit_append(bigint, text, text, text, text, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.audit_append(bigint, text, text, text, text, uuid, jsonb, timestamptz)
  to service_role;
