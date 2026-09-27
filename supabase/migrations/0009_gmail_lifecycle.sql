create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  email_address text,
  refresh_token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  granted_scope text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gmail_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  gmail_message_id text not null,
  thread_id text,
  sender text,
  subject text,
  snippet text,
  received_at timestamptz,
  classification text not null default 'unknown'
    check (classification in (
      'application-received',
      'assessment',
      'interview',
      'offer',
      'rejection',
      'recruiter',
      'unknown'
    )),
  classification_reason text,
  matched_application_id uuid references public.applications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(owner_id, gmail_message_id)
);

create index if not exists gmail_messages_owner_received_idx
  on public.gmail_messages(owner_id, received_at desc);

create index if not exists gmail_messages_application_idx
  on public.gmail_messages(matched_application_id)
  where matched_application_id is not null;

alter table public.gmail_connections enable row level security;
alter table public.gmail_messages enable row level security;

-- OAuth refresh tokens remain service-role only. There is intentionally no
-- authenticated SELECT policy on gmail_connections.
drop policy if exists "owners can read gmail lifecycle messages" on public.gmail_messages;
create policy "owners can read gmail lifecycle messages"
  on public.gmail_messages
  for select
  to authenticated
  using (owner_id = auth.uid());
