-- Gmail OAuth hardening: make the connection write path robust to drift.
-- The OAuth callback upserts on owner_id, so exactly one row per user must be
-- enforceable, and browser reads need a stable status-only policy set.
-- Every statement below is idempotent and safe to apply on top of 0009/0020.

-- 1. One Gmail connection per owner (required for onConflict: "owner_id").
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gmail_connections'::regclass
      and contype = 'u'
      and conkey = ARRAY[
        (select attnum from pg_attribute
          where attrelid = 'public.gmail_connections'::regclass
            and attname = 'owner_id')
      ]
  ) then
    alter table public.gmail_connections
      add constraint gmail_connections_owner_id_key unique (owner_id);
  end if;
end;
$$;

-- 2. RLS stays enabled; browser reads remain status-only (no token columns).
alter table public.gmail_connections enable row level security;

grant select (owner_id, email_address, granted_scope, active, last_synced_at, last_error, updated_at)
  on table public.gmail_connections to authenticated;
grant insert, update on table public.gmail_connections to authenticated;

drop policy if exists "owners can read gmail connection status" on public.gmail_connections;
create policy "owners can read gmail connection status"
on public.gmail_connections for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "owners can insert gmail connections" on public.gmail_connections;
create policy "owners can insert gmail connections"
on public.gmail_connections for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "owners can update gmail connections" on public.gmail_connections;
create policy "owners can update gmail connections"
on public.gmail_connections for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
