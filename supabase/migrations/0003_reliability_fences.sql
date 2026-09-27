-- Reliability and idempotency primitives inspired by battle-tested queue/apply architectures.
-- These constraints live in Postgres so a crashed or duplicated worker cannot silently double-apply.

alter table public.jobs
  add column if not exists canonical_url text,
  add column if not exists dedupe_key text,
  add column if not exists content_fingerprint text;

create unique index if not exists jobs_canonical_url_unique
  on public.jobs(canonical_url)
  where canonical_url is not null and canonical_url <> '';

create unique index if not exists jobs_dedupe_key_unique
  on public.jobs(dedupe_key)
  where dedupe_key is not null and dedupe_key <> '';

alter table public.agent_tasks
  add column if not exists idempotency_key text,
  add column if not exists worker_id text,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists max_attempts integer not null default 3;

create unique index if not exists agent_tasks_idempotency_unique
  on public.agent_tasks(idempotency_key)
  where idempotency_key is not null;

create index if not exists agent_tasks_claim_idx
  on public.agent_tasks(status, available_at, priority, created_at);

alter table public.applications
  add column if not exists submission_fenced_at timestamptz,
  add column if not exists confirmation_verified_at timestamptz,
  add column if not exists confirmation_url text,
  add column if not exists last_attempt_id uuid;

create table if not exists public.company_policy (
  normalized_company text primary key,
  blocked boolean not null default false,
  block_reason text,
  max_daily_submissions integer not null default 5 check (max_daily_submissions >= 0),
  max_lifetime_submissions integer not null default 10 check (max_lifetime_submissions >= 0),
  cooldown_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.application_attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  worker_id text,
  stage text not null,
  status text not null check (status in ('started','blocked','failed','verified','submitted','unknown')),
  field_report jsonb not null default '{}'::jsonb,
  screenshot_path text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.company_policy enable row level security;
alter table public.application_attempts enable row level security;

alter table public.applications
  add constraint applications_last_attempt_fk
  foreign key (last_attempt_id)
  references public.application_attempts(id)
  deferrable initially deferred;

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
  order by priority asc, created_at asc
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
  'Atomically claims one task with SKIP LOCKED and a lease, preventing concurrent workers from processing the same task.';

create or replace function public.can_submit_application(p_application_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.applications;
  job public.jobs;
  policy public.company_policy;
  normalized text;
  daily_count integer;
  lifetime_count integer;
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
