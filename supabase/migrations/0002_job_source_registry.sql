create table public.job_source_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('greenhouse','lever','ashby')),
  board_key text not null,
  display_name text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, board_key)
);

alter table public.job_source_registry enable row level security;

comment on table public.job_source_registry is
  'Public ATS boards that RemoteJobOS is allowed to query. Service-role workers manage this registry.';
