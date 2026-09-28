alter table public.agent_approvals
  add column if not exists decision_source text not null default 'manual'
    check (decision_source in ('manual','policy')),
  add column if not exists decision_reason text;

alter table public.applications
  alter column autonomy_mode set default 'auto-except';

create table if not exists public.answer_vault (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.career_profiles(id) on delete cascade,
  answer_key text not null,
  label text not null,
  answer_value text not null,
  reuse_policy text not null default 'always'
    check (reuse_policy in ('always','ask','never')),
  sensitive boolean not null default false,
  aliases jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id, answer_key)
);

create index if not exists answer_vault_profile_idx
  on public.answer_vault(profile_id, updated_at desc);

create table if not exists public.application_exceptions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  exception_type text not null
    check (exception_type in (
      'missing-answer',
      'sensitive-answer',
      'captcha',
      'unsupported-ats',
      'policy-block',
      'submit-uncertain',
      'retry-exhausted',
      'verification-failed',
      'other'
    )),
  status text not null default 'open'
    check (status in ('open','resolved','dismissed')),
  field_key text,
  field_label text,
  title text not null,
  detail text not null,
  payload jsonb not null default '{}'::jsonb,
  resolution jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists application_exceptions_application_idx
  on public.application_exceptions(application_id, status, created_at desc);
create index if not exists application_exceptions_run_idx
  on public.application_exceptions(run_id)
  where run_id is not null;

create table if not exists public.notification_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  email_address text,
  notify_exceptions boolean not null default true,
  notify_submitted boolean not null default true,
  notify_assessment boolean not null default true,
  notify_interview boolean not null default true,
  notify_offer boolean not null default true,
  notify_rejection boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  exception_id uuid references public.application_exceptions(id) on delete cascade,
  kind text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox(status, available_at)
  where status in ('pending','failed');
create index if not exists notification_outbox_owner_idx
  on public.notification_outbox(owner_id, created_at desc);

alter table public.answer_vault enable row level security;
alter table public.application_exceptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_outbox enable row level security;

grant select, insert, update, delete on table public.answer_vault to authenticated;
grant select on table public.application_exceptions to authenticated;
grant select, insert, update, delete on table public.notification_preferences to authenticated;
grant select on table public.notification_outbox to authenticated;

drop policy if exists "owners manage answer vault" on public.answer_vault;
create policy "owners manage answer vault"
on public.answer_vault
for all to authenticated
using (
  exists (
    select 1 from public.career_profiles p
    where p.id = answer_vault.profile_id
      and p.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.career_profiles p
    where p.id = answer_vault.profile_id
      and p.owner_id = (select auth.uid())
  )
);

drop policy if exists "owners read application exceptions" on public.application_exceptions;
create policy "owners read application exceptions"
on public.application_exceptions
for select to authenticated
using (
  exists (
    select 1
    from public.applications a
    join public.career_profiles p on p.id = a.profile_id
    where a.id = application_exceptions.application_id
      and p.owner_id = (select auth.uid())
  )
);

drop policy if exists "owners manage notification preferences" on public.notification_preferences;
create policy "owners manage notification preferences"
on public.notification_preferences
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "owners read notification outbox" on public.notification_outbox;
create policy "owners read notification outbox"
on public.notification_outbox
for select to authenticated
using (owner_id = (select auth.uid()));

revoke insert, update, delete on table public.application_exceptions from authenticated;
revoke insert, update, delete on table public.notification_outbox from authenticated;

-- Existing not-yet-submitted applications should adopt the new default.
update public.applications
set autonomy_mode = 'auto-except'
where autonomy_mode = 'review'
  and submitted_at is null;
