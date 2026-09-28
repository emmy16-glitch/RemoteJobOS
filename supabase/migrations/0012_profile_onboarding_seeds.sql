create table if not exists public.profile_onboarding_seeds (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null unique,
  display_name text not null,
  profile jsonb not null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_onboarding_seeds enable row level security;

revoke all on table public.profile_onboarding_seeds from anon, authenticated;
grant select, insert, update, delete on table public.profile_onboarding_seeds to service_role;

comment on table public.profile_onboarding_seeds is
  'Server-only verified career profile seeds claimed into owner-protected career_profiles after first authenticated sign-in.';

create or replace function public.claim_profile_onboarding_seed(
  p_user_id uuid,
  p_email text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_seed public.profile_onboarding_seeds%rowtype;
  v_email text;
begin
  if p_user_id is null or p_email is null or btrim(p_email) = '' then
    return null;
  end if;

  select id
    into v_profile_id
  from public.career_profiles
  where owner_id = p_user_id
  order by updated_at desc
  limit 1;

  if v_profile_id is not null then
    return v_profile_id;
  end if;

  v_email := lower(btrim(p_email));

  select *
    into v_seed
  from public.profile_onboarding_seeds
  where normalized_email = v_email
    and claimed_at is null
  for update
  limit 1;

  if not found then
    return null;
  end if;

  insert into public.career_profiles (owner_id, display_name, profile)
  values (p_user_id, v_seed.display_name, v_seed.profile)
  returning id into v_profile_id;

  update public.profile_onboarding_seeds
  set claimed_by = p_user_id,
      claimed_at = now(),
      updated_at = now()
  where id = v_seed.id;

  return v_profile_id;
end;
$$;

revoke execute on function public.claim_profile_onboarding_seed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_profile_onboarding_seed(uuid, text)
  to service_role;
