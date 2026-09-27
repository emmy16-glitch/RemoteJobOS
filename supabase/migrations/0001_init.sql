create extension if not exists "pgcrypto";

create type public.remote_scope as enum ('global','africa','emea','us-only','eu-only','uk-only','country-restricted','unknown');
create type public.application_status as enum ('discovered','shortlisted','cv-prepared','ready-for-review','applied','response','assessment','interview','offer','rejected','withdrawn');
create type public.task_status as enum ('pending','claimed','completed','failed','blocked');

create table public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  display_name text,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  title text not null,
  company text not null,
  description text not null default '',
  apply_url text not null,
  source_url text,
  posted_at timestamptz,
  salary_text text,
  location_text text,
  remote boolean not null default true,
  remote_scope public.remote_scope not null default 'unknown',
  role_family text not null default 'other-tech',
  tags jsonb not null default '[]'::jsonb,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(source, external_id)
);

create index jobs_remote_role_idx on public.jobs(remote, role_family);
create index jobs_discovered_at_idx on public.jobs(discovered_at desc);

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid references public.career_profiles(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  decision text not null check (decision in ('reject','review','strong-match')),
  breakdown jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(job_id, profile_id)
);

create table public.cv_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.career_profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  family text not null,
  version integer not null default 1,
  content jsonb not null,
  storage_path text,
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid references public.career_profiles(id) on delete cascade,
  cv_version_id uuid references public.cv_versions(id) on delete set null,
  status public.application_status not null default 'discovered',
  autonomy_mode text not null default 'review',
  submitted_at timestamptz,
  next_action text,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, profile_id)
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.task_status not null default 'pending',
  priority integer not null default 100,
  attempts integer not null default 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index agent_tasks_queue_idx on public.agent_tasks(status, priority, created_at);

create table public.agent_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  severity text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.career_profiles enable row level security;
alter table public.job_matches enable row level security;
alter table public.cv_versions enable row level security;
alter table public.applications enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_events enable row level security;

alter table public.jobs enable row level security;
create policy "public can read discovered jobs" on public.jobs for select using (true);
