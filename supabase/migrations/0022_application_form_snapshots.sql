create table if not exists public.application_form_snapshots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  attempt_id uuid not null references public.application_attempts(id) on delete cascade,
  cv_version_id uuid references public.cv_versions(id) on delete set null,
  form_url text,
  adapter text,
  phase text not null default 'planned' check (phase in ('planned','verified','submitted')),
  fields jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  verified boolean not null default false,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id)
);

create index if not exists application_form_snapshots_application_id_idx
  on public.application_form_snapshots(application_id, captured_at desc);

alter table public.application_form_snapshots enable row level security;

revoke all on table public.application_form_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.application_form_snapshots to service_role;

comment on table public.application_form_snapshots is
  'Server-only audit snapshots of the exact application form plan used by RemoteJobOS. Dashboard reads are performed server-side only after application ownership is verified.';
