create or replace function public.claim_own_profile_onboarding_seed()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_profile_id uuid;
  v_seed public.profile_onboarding_seeds%rowtype;
begin
  v_uid := auth.uid();
  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));

  if v_uid is null or v_email = '' then
    return null;
  end if;

  select id
    into v_profile_id
  from public.career_profiles
  where owner_id = v_uid
  order by updated_at desc
  limit 1;

  if v_profile_id is not null then
    return v_profile_id;
  end if;

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
  values (v_uid, v_seed.display_name, v_seed.profile)
  returning id into v_profile_id;

  update public.profile_onboarding_seeds
  set claimed_by = v_uid,
      claimed_at = now(),
      updated_at = now()
  where id = v_seed.id;

  return v_profile_id;
end;
$$;

revoke execute on function public.claim_own_profile_onboarding_seed()
  from public, anon;
grant execute on function public.claim_own_profile_onboarding_seed()
  to authenticated;

grant select on table public.job_source_state to authenticated;
drop policy if exists "authenticated can read job source state" on public.job_source_state;
create policy "authenticated can read job source state"
on public.job_source_state for select to authenticated
using (true);

grant select on table public.job_source_runs to authenticated;
drop policy if exists "authenticated can read job source runs" on public.job_source_runs;
create policy "authenticated can read job source runs"
on public.job_source_runs for select to authenticated
using (true);

grant select on table public.company_policy to authenticated;
drop policy if exists "authenticated can read company policy" on public.company_policy;
create policy "authenticated can read company policy"
on public.company_policy for select to authenticated
using (true);

grant select (owner_id,email_address,granted_scope,active,last_synced_at,last_error,updated_at)
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

drop policy if exists "owners can read rendered CV assets" on storage.objects;
create policy "owners can read rendered CV assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'application-assets'
  and exists (
    select 1
    from public.cv_versions cv
    join public.career_profiles profile on profile.id = cv.profile_id
    where cv.storage_path = storage.objects.name
      and profile.owner_id = (select auth.uid())
  )
);
