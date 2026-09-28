create or replace function public.release_submission_fence(
  p_application_id uuid,
  p_attempt_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  changed integer;
begin
  update public.applications
  set submission_fenced_at = null
  where id = p_application_id
    and last_attempt_id = p_attempt_id
    and submitted_at is null
    and confirmation_verified_at is null;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke execute on function public.release_submission_fence(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_submission_fence(uuid, uuid)
  to service_role;

create or replace function public.claim_agent_task_by_key(
  p_worker_id text,
  p_idempotency_key text,
  p_lease_seconds integer default 900
)
returns setof public.agent_tasks
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed public.agent_tasks;
begin
  select *
  into claimed
  from public.agent_tasks
  where idempotency_key = p_idempotency_key
    and status in ('pending','failed')
    and available_at <= now()
    and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at < now())
  for update skip locked
  limit 1;

  if claimed.id is null then
    return;
  end if;

  update public.agent_tasks
  set status = 'claimed',
      worker_id = p_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(60, p_lease_seconds)),
      attempts = attempts + 1,
      claimed_at = now()
  where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

revoke execute on function public.claim_agent_task_by_key(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_agent_task_by_key(text, text, integer)
  to service_role;
