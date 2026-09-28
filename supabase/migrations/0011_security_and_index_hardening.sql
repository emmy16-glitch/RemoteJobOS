revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

create index if not exists application_attempts_application_id_idx
  on public.application_attempts(application_id);
create index if not exists applications_cv_version_id_idx
  on public.applications(cv_version_id);
create index if not exists applications_last_attempt_id_idx
  on public.applications(last_attempt_id);
create index if not exists applications_profile_id_idx
  on public.applications(profile_id);
create index if not exists cv_versions_job_id_idx
  on public.cv_versions(job_id);
create index if not exists cv_versions_profile_id_idx
  on public.cv_versions(profile_id);
create index if not exists job_matches_profile_id_idx
  on public.job_matches(profile_id);

drop policy if exists "owners can read career profiles" on public.career_profiles;
create policy "owners can read career profiles"
  on public.career_profiles for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "owners can insert career profiles" on public.career_profiles;
create policy "owners can insert career profiles"
  on public.career_profiles for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners can update career profiles" on public.career_profiles;
create policy "owners can update career profiles"
  on public.career_profiles for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "owners can read job matches" on public.job_matches;
create policy "owners can read job matches"
  on public.job_matches for select to authenticated
  using (
    exists (
      select 1 from public.career_profiles profile
      where profile.id = job_matches.profile_id
        and profile.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners can read cv versions" on public.cv_versions;
create policy "owners can read cv versions"
  on public.cv_versions for select to authenticated
  using (
    exists (
      select 1 from public.career_profiles profile
      where profile.id = cv_versions.profile_id
        and profile.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners can read applications" on public.applications;
create policy "owners can read applications"
  on public.applications for select to authenticated
  using (
    exists (
      select 1 from public.career_profiles profile
      where profile.id = applications.profile_id
        and profile.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners can update applications" on public.applications;
create policy "owners can update applications"
  on public.applications for update to authenticated
  using (
    exists (
      select 1 from public.career_profiles profile
      where profile.id = applications.profile_id
        and profile.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.career_profiles profile
      where profile.id = applications.profile_id
        and profile.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owners can read gmail lifecycle messages" on public.gmail_messages;
create policy "owners can read gmail lifecycle messages"
  on public.gmail_messages for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.agent_events from anon, authenticated;
revoke all on table public.agent_tasks from anon, authenticated;
revoke all on table public.application_attempts from anon, authenticated;
revoke all on table public.company_policy from anon, authenticated;
revoke all on table public.gmail_connections from anon, authenticated;
revoke all on table public.job_source_registry from anon, authenticated;
revoke all on table public.job_source_runs from anon, authenticated;
revoke all on table public.job_source_state from anon, authenticated;
