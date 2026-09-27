alter table public.career_profiles
  alter column owner_id set default auth.uid();

drop policy if exists "owners can read career profiles" on public.career_profiles;
create policy "owners can read career profiles"
  on public.career_profiles
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "owners can insert career profiles" on public.career_profiles;
create policy "owners can insert career profiles"
  on public.career_profiles
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "owners can update career profiles" on public.career_profiles;
create policy "owners can update career profiles"
  on public.career_profiles
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owners can read job matches" on public.job_matches;
create policy "owners can read job matches"
  on public.job_matches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.career_profiles profile
      where profile.id = job_matches.profile_id
        and profile.owner_id = auth.uid()
    )
  );

drop policy if exists "owners can read cv versions" on public.cv_versions;
create policy "owners can read cv versions"
  on public.cv_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.career_profiles profile
      where profile.id = cv_versions.profile_id
        and profile.owner_id = auth.uid()
    )
  );

drop policy if exists "owners can read applications" on public.applications;
create policy "owners can read applications"
  on public.applications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.career_profiles profile
      where profile.id = applications.profile_id
        and profile.owner_id = auth.uid()
    )
  );

drop policy if exists "owners can update applications" on public.applications;
create policy "owners can update applications"
  on public.applications
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.career_profiles profile
      where profile.id = applications.profile_id
        and profile.owner_id = auth.uid()
    )
  );
