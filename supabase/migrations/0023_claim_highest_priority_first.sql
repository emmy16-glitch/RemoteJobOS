create or replace function public.claim_agent_task(
  p_worker_id text,
  p_task_types text[] default null,
  p_lease_seconds integer default 900
)
returns setof public.agent_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.agent_tasks;
begin
  select *
  into claimed
  from public.agent_tasks
  where status in ('pending','failed')
    and available_at <= now()
    and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at < now())
    and (p_task_types is null or task_type = any(p_task_types))
  order by priority desc, created_at asc
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

comment on function public.claim_agent_task is
  'Atomically claims the highest-priority available task with SKIP LOCKED and a lease.';
