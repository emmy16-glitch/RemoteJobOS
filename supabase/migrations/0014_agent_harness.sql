create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete set null,
  run_type text not null default 'application'
    check (run_type in ('application')),
  mode text not null default 'dry-run'
    check (mode in ('dry-run','submit')),
  status text not null default 'pending'
    check (status in ('pending','running','waiting-approval','completed','failed','blocked','cancelled')),
  phase text not null default 'assemble',
  step_used integer not null default 0 check (step_used >= 0),
  step_limit integer not null default 12 check (step_limit between 1 and 100),
  active_tool_families jsonb not null default '[]'::jsonb,
  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  recovery_strategy text not null default 'safe-restart'
    check (recovery_strategy in ('safe-restart','manual-reconcile','already-complete')),
  last_error text,
  idempotency_key text not null unique,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_runs_application_updated_idx
  on public.agent_runs(application_id, updated_at desc);
create index agent_runs_status_updated_idx
  on public.agent_runs(status, updated_at);
create index agent_runs_task_idx
  on public.agent_runs(task_id)
  where task_id is not null;

create table public.agent_run_checkpoints (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_used integer not null,
  phase text not null,
  status text not null,
  active_tool_families jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agent_run_checkpoints_run_idx
  on public.agent_run_checkpoints(run_id, id desc);

create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  approval_type text not null default 'submit-application'
    check (approval_type in ('submit-application')),
  status text not null default 'pending'
    check (status in ('pending','approved','denied','expired','executed','cancelled')),
  summary text not null,
  snapshot jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  executed_at timestamptz,
  unique(run_id, approval_type)
);

create index agent_approvals_application_status_idx
  on public.agent_approvals(application_id, status, requested_at desc);

alter table public.agent_runs enable row level security;
alter table public.agent_run_checkpoints enable row level security;
alter table public.agent_approvals enable row level security;

revoke all on table public.agent_runs from anon, authenticated;
revoke all on table public.agent_run_checkpoints from anon, authenticated;
revoke all on table public.agent_approvals from anon, authenticated;

grant select on table public.agent_runs to authenticated;
grant select on table public.agent_run_checkpoints to authenticated;
grant select on table public.agent_approvals to authenticated;

create policy "owners can read agent runs"
on public.agent_runs for select to authenticated
using (
  exists (
    select 1
    from public.applications a
    join public.career_profiles p on p.id = a.profile_id
    where a.id = agent_runs.application_id
      and p.owner_id = (select auth.uid())
  )
);

create policy "owners can read agent run checkpoints"
on public.agent_run_checkpoints for select to authenticated
using (
  exists (
    select 1
    from public.agent_runs r
    join public.applications a on a.id = r.application_id
    join public.career_profiles p on p.id = a.profile_id
    where r.id = agent_run_checkpoints.run_id
      and p.owner_id = (select auth.uid())
  )
);

create policy "owners can read agent approvals"
on public.agent_approvals for select to authenticated
using (
  exists (
    select 1
    from public.applications a
    join public.career_profiles p on p.id = a.profile_id
    where a.id = agent_approvals.application_id
      and p.owner_id = (select auth.uid())
  )
);
