create table if not exists public.job_source_state (
  source text primary key,
  consecutive_failures integer not null default 0,
  circuit_open_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_job_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.job_source_runs (
  id bigint generated always as identity primary key,
  source text not null,
  success boolean not null,
  job_count integer not null default 0,
  duration_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists job_source_runs_source_created_idx
  on public.job_source_runs(source, created_at desc);

alter table public.job_source_state enable row level security;
alter table public.job_source_runs enable row level security;

create or replace function public.record_job_source_run(
  p_source text,
  p_success boolean,
  p_job_count integer default 0,
  p_duration_ms integer default 0,
  p_error text default null
)
returns public.job_source_state
language plpgsql
security definer
set search_path = public
as $$
declare
  current_failures integer;
  result public.job_source_state;
begin
  insert into public.job_source_runs(source, success, job_count, duration_ms, error)
  values (p_source, p_success, greatest(0, p_job_count), greatest(0, p_duration_ms), p_error);

  select consecutive_failures into current_failures
  from public.job_source_state
  where source = p_source;

  current_failures := coalesce(current_failures, 0);

  insert into public.job_source_state(
    source,
    consecutive_failures,
    circuit_open_until,
    last_success_at,
    last_failure_at,
    last_error,
    last_job_count,
    updated_at
  )
  values (
    p_source,
    case when p_success then 0 else current_failures + 1 end,
    case
      when p_success then null
      when current_failures + 1 >= 3 then now() + interval '30 minutes'
      else null
    end,
    case when p_success then now() else null end,
    case when p_success then null else now() end,
    case when p_success then null else p_error end,
    greatest(0, p_job_count),
    now()
  )
  on conflict (source) do update
  set
    consecutive_failures = excluded.consecutive_failures,
    circuit_open_until = excluded.circuit_open_until,
    last_success_at = coalesce(excluded.last_success_at, public.job_source_state.last_success_at),
    last_failure_at = coalesce(excluded.last_failure_at, public.job_source_state.last_failure_at),
    last_error = excluded.last_error,
    last_job_count = excluded.last_job_count,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;
