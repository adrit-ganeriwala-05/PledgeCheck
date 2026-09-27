-- Audit chain database functions. Owner: Nihalika. Run after schema.sql, policies.sql
-- and functions.sql. Adds functions and grants only; alters no table, policy or trigger.

-- ---------------------------------------------------------------------------
-- audit_append: insert one hash-chained audit event.
--
-- All inserts into audit_events go through this function with an explicit seq, so the
-- bigserial default (audit_events_seq_seq) is never used.
--
-- The caller (apps/web/lib/audit/append.ts) reads the head, computes the hash in
-- TypeScript and passes it in. This function computes no hashes, so the writer and the
-- verifier share one implementation. It re-checks that the caller's view of the head is
-- still current:
--   p_seq       must equal head seq + 1   (1 when the table is empty)
--   p_prev_hash must equal head hash      (64 zeros when the table is empty)
-- Otherwise it raises SQLSTATE PT409 'audit_chain_conflict' and the caller retries.
--
-- Why this check is worth a function at all, rather than a plain insert: `seq` being the
-- primary key stops two writers creating the same row, but nothing stops a writer
-- inserting seq N with a prev_hash that is not row N-1's hash. That is a silently forked
-- chain that only surfaces later, when someone verifies it. This function is the one
-- place that invariant is enforced, whichever client does the writing.
--
-- Why there is no advisory lock: an earlier version serialized writers on
-- pg_advisory_xact_lock(hashtext('audit_events_chain')). It is not needed for
-- correctness. If our insert of seq N succeeds then no other row N exists (primary key),
-- at check time the head was (N-1, H) with p_prev_hash = H, and row N-1 can never change
-- afterwards (the append-only trigger in policies.sql), so the row provably chains onto
-- N-1. A racing writer simply loses the insert and retries. The lock only saved a retry,
-- and in exchange a single stuck holder blocked every audit write indefinitely and
-- exhausted the PostgREST connection pool, taking the whole REST API down with it.
--
-- Why PT409 and not 40001: an earlier version raised 40001, which is the standard code
-- for serialization_failure, i.e. "this transaction hit a transient conflict, run it
-- again". PostgREST believes that and retries the request itself. Our conflict is not
-- transient: a stale head raises it on every attempt, so PostgREST retried forever, the
-- caller's request never returned, and each attempt logged a Postgres ERROR (hundreds
-- per second in a live incident on 2026-09-26). The same function raising 22023 answered
-- in 0.13s, which is what isolated it. PT409 is PostgREST's convention for "respond
-- HTTP 409", so the client now gets one prompt Conflict and does its own retry, which is
-- where the retry belongs: apps/web/lib/audit/append.ts re-reads the head first, and
-- retrying without doing that can never succeed.
--
-- Error codes:
--   PT409  audit_chain_conflict (stale head, or lost the race; re-read the head, retry)
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

  select e.seq, e.hash into v_head_seq, v_head_hash
  from public.audit_events e
  order by e.seq desc
  limit 1;

  if not found then
    v_head_seq := 0;
    v_head_hash := repeat('0', 64);
  end if;

  if p_seq is distinct from v_head_seq + 1 or p_prev_hash is distinct from v_head_hash then
    raise exception 'audit_chain_conflict' using errcode = 'PT409';
  end if;

  -- Two writers that read the same head both reach this insert; the primary key lets
  -- exactly one through. The loser is in the same position as a stale head, so it gets
  -- the same error code and the same retry. Only reachable under real concurrency: in a
  -- single session an existing row N would already have failed the head check above.
  begin
    insert into public.audit_events (seq, actor, action, ref_id, payload, created_at, prev_hash, hash)
    values (p_seq, p_actor, p_action, p_ref_id, coalesce(p_payload, '{}'::jsonb), p_created_at, p_prev_hash, p_hash);
  exception when unique_violation then
    raise exception 'audit_chain_conflict' using errcode = 'PT409';
  end;

  return p_seq;
end;
$$;

revoke all on function public.audit_append(bigint, text, text, text, text, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.audit_append(bigint, text, text, text, text, uuid, jsonb, timestamptz)
  to service_role;
