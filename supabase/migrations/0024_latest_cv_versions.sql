create index if not exists cv_versions_profile_job_version_idx
  on public.cv_versions(profile_id, job_id, version desc);

create or replace function public.latest_cv_versions(
  p_profile_id uuid,
  p_job_ids uuid[]
)
returns table(
  job_id uuid,
  version integer,
  content jsonb
)
language sql
security invoker
set search_path = public
as $$
  select distinct on (cv.job_id)
    cv.job_id,
    cv.version,
    cv.content
  from public.cv_versions cv
  where cv.profile_id = p_profile_id
    and cv.job_id = any(p_job_ids)
    and cv.family is not null
  order by cv.job_id, cv.version desc;
$$;

revoke all on function public.latest_cv_versions(uuid, uuid[]) from public;
revoke all on function public.latest_cv_versions(uuid, uuid[]) from anon;
revoke all on function public.latest_cv_versions(uuid, uuid[]) from authenticated;
grant execute on function public.latest_cv_versions(uuid, uuid[]) to service_role;
