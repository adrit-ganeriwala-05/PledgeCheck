-- Database functions. Owner: Adrit. Run after policies.sql.

-- ---------------------------------------------------------------------------
-- submit_review: record a prescriber's decision atomically.
--
-- Server-only: executable by service_role alone, so the only way to record a review is
-- POST /api/reviews, which also runs the rules engine, writes the audit event and deletes
-- the photo. The route verifies the session and passes the clinician's id as
-- p_clinician_id; the function re-checks that clinician here. In one transaction it:
--   1. checks p_clinician_id is a prescriber in the submission's practice (42501)
--   2. locks the submission; it must be ready_for_review or needs_review  (PC409)
--   3. inserts the review (unique per submission; a duplicate raises)     (23505)
--   4. sets submissions.status to approved / rejected
--   5. on approval with p_window, inserts an open windows row
-- The function computes no dates: p_window comes from the rules engine (Labib) and has
-- keys opens_at, closes_at (timestamptz) and is_first_rx (boolean, default false).
-- The photo is deleted by the route afterwards, not here.
--
-- Error codes the route maps:
--   P0002  submission not found               -> 404
--   42501  not a prescriber in that practice  -> 403
--   PC409  submission not reviewable          -> 409
--   23505  already reviewed                   -> 409
--   22023  invalid decision or window (missing dates, or closes_at not after opens_at) -> 400
--
-- Returns {"status": text, "window": {"opens_at", "closes_at", "is_first_rx"} | null}.
-- ---------------------------------------------------------------------------
-- Earlier signature (callable by signed-in users); removed so it cannot linger.
drop function if exists public.submit_review(uuid, text, text, jsonb);

create or replace function public.submit_review(
  p_clinician_id uuid,
  p_submission_id uuid,
  p_decision text,
  p_reason text,
  p_window jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := p_clinician_id;
  v_status text;
  v_practice_id uuid;
  v_patient_id uuid;
  v_window public.windows;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;

  select s.status, p.practice_id, p.id
    into v_status, v_practice_id, v_patient_id
  from public.submissions s
  join public.test_requests r on r.id = s.request_id
  join public.patients p on p.id = r.patient_id
  where s.id = p_submission_id
  for update of s;

  if not found then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;

  if v_uid is null or not exists (
    select 1 from public.clinicians c
    where c.id = v_uid and c.role = 'prescriber' and c.practice_id = v_practice_id
  ) then
    raise exception 'only a prescriber in this practice can review' using errcode = '42501';
  end if;

  if v_status not in ('ready_for_review', 'needs_review') then
    raise exception 'submission is not reviewable (status %)', v_status using errcode = 'PC409';
  end if;

  insert into public.reviews (submission_id, clinician_id, decision, reason)
  values (p_submission_id, v_uid, p_decision, p_reason);

  update public.submissions set status = p_decision where id = p_submission_id;

  if p_decision = 'approved' and p_window is not null and jsonb_typeof(p_window) <> 'null' then
    if p_window ->> 'opens_at' is null or p_window ->> 'closes_at' is null then
      raise exception 'window requires opens_at and closes_at' using errcode = '22023';
    end if;
    if (p_window ->> 'closes_at')::timestamptz <= (p_window ->> 'opens_at')::timestamptz then
      raise exception 'window closes_at must be after opens_at' using errcode = '22023';
    end if;

    insert into public.windows (patient_id, submission_id, is_first_rx, opens_at, closes_at, status)
    values (
      v_patient_id,
      p_submission_id,
      coalesce((p_window ->> 'is_first_rx')::boolean, false),
      (p_window ->> 'opens_at')::timestamptz,
      (p_window ->> 'closes_at')::timestamptz,
      'open'
    )
    returning * into v_window;
  end if;

  return jsonb_build_object(
    'status', p_decision,
    'window', case when v_window.id is null then null else jsonb_build_object(
      'opens_at', v_window.opens_at,
      'closes_at', v_window.closes_at,
      'is_first_rx', v_window.is_first_rx
    ) end
  );
end;
$$;

revoke all on function public.submit_review(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_review(uuid, uuid, text, text, jsonb) to service_role;
