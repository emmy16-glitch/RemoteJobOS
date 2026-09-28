alter table public.agent_runs
  add column if not exists submit_attempts integer not null default 0
    check (submit_attempts >= 0 and submit_attempts <= 20);

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


create or replace function public.reserve_agent_submit_attempt(
  p_run_id uuid,
  p_max_attempts integer default 3
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_attempt integer;
begin
  update public.agent_runs
  set submit_attempts = submit_attempts + 1,
      updated_at = now()
  where id = p_run_id
    and submit_attempts < greatest(1, least(20, p_max_attempts))
    and status in ('pending','running','failed')
  returning submit_attempts into next_attempt;

  return next_attempt;
end;
$$;

revoke execute on function public.reserve_agent_submit_attempt(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_agent_submit_attempt(uuid, integer)
  to service_role;


create or replace function public.can_submit_application(p_application_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  app public.applications;
  job public.jobs;
  policy public.company_policy;
  normalized text;
  daily_count integer;
  lifetime_count integer;
  has_approval boolean;
begin
  select * into app from public.applications where id = p_application_id;
  if app.id is null then
    return query select false, 'application-not-found';
    return;
  end if;

  if app.submission_fenced_at is not null or app.submitted_at is not null then
    return query select false, 'already-fenced-or-submitted';
    return;
  end if;

  select exists (
    select 1
    from public.agent_approvals approval
    join public.agent_runs run on run.id = approval.run_id
    where approval.application_id = p_application_id
      and approval.status = 'approved'
      and run.application_id = p_application_id
      and run.status in ('pending','running','failed')
  ) into has_approval;

  if not has_approval then
    return query select false, 'approval-required';
    return;
  end if;

  select * into job from public.jobs where id = app.job_id;
  normalized := lower(regexp_replace(coalesce(job.company, ''), '[^a-z0-9]+', '', 'g'));

  select * into policy from public.company_policy where normalized_company = normalized;
  if policy.normalized_company is not null then
    if policy.blocked then
      return query select false, 'company-blocked';
      return;
    end if;
    if policy.cooldown_until is not null and policy.cooldown_until > now() then
      return query select false, 'company-cooldown';
      return;
    end if;
  end if;

  select count(*) into daily_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.submitted_at >= date_trunc('day', now())
    and lower(regexp_replace(coalesce(j.company, ''), '[^a-z0-9]+', '', 'g')) = normalized;

  select count(*) into lifetime_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.submitted_at is not null
    and lower(regexp_replace(coalesce(j.company, ''), '[^a-z0-9]+', '', 'g')) = normalized;

  if daily_count >= coalesce(policy.max_daily_submissions, 5) then
    return query select false, 'company-daily-limit';
    return;
  end if;

  if lifetime_count >= coalesce(policy.max_lifetime_submissions, 10) then
    return query select false, 'company-lifetime-limit';
    return;
  end if;

  return query select true, 'ok';
end;
$$;

revoke execute on function public.can_submit_application(uuid)
  from public, anon, authenticated;
grant execute on function public.can_submit_application(uuid)
  to service_role;
