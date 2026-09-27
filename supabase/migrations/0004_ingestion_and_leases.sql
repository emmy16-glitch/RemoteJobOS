create or replace function public.ingest_discovered_jobs(p_jobs jsonb)
returns table(inserted integer, updated integer, skipped integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  existing_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
begin
  if jsonb_typeof(p_jobs) <> 'array' then
    raise exception 'p_jobs must be a JSON array';
  end if;

  for item in select * from jsonb_array_elements(p_jobs)
  loop
    existing_id := null;

    select id into existing_id
    from public.jobs
    where
      (canonical_url is not null and canonical_url = nullif(item->>'canonical_url', ''))
      or (dedupe_key is not null and dedupe_key = nullif(item->>'dedupe_key', ''))
      or (source = item->>'source' and external_id = item->>'external_id')
    order by
      case when source = item->>'source' and external_id = item->>'external_id' then 0 else 1 end,
      discovered_at asc
    limit 1;

    if existing_id is not null then
      update public.jobs
      set
        title = coalesce(nullif(item->>'title', ''), title),
        company = coalesce(nullif(item->>'company', ''), company),
        description = case
          when length(coalesce(item->>'description', '')) >= length(description)
            then coalesce(item->>'description', description)
          else description
        end,
        apply_url = coalesce(nullif(item->>'apply_url', ''), apply_url),
        source_url = coalesce(nullif(item->>'source_url', ''), source_url),
        posted_at = coalesce((item->>'posted_at')::timestamptz, posted_at),
        salary_text = coalesce(nullif(item->>'salary_text', ''), salary_text),
        location_text = coalesce(nullif(item->>'location_text', ''), location_text),
        remote = coalesce((item->>'remote')::boolean, remote),
        remote_scope = coalesce((item->>'remote_scope')::public.remote_scope, remote_scope),
        role_family = coalesce(nullif(item->>'role_family', ''), role_family),
        tags = coalesce(item->'tags', tags),
        canonical_url = coalesce(nullif(item->>'canonical_url', ''), canonical_url),
        dedupe_key = coalesce(nullif(item->>'dedupe_key', ''), dedupe_key),
        content_fingerprint = coalesce(nullif(item->>'content_fingerprint', ''), content_fingerprint),
        last_seen_at = now()
      where id = existing_id;

      updated_count := updated_count + 1;
    else
      begin
        insert into public.jobs (
          source, external_id, title, company, description, apply_url, source_url,
          posted_at, salary_text, location_text, remote, remote_scope, role_family,
          tags, canonical_url, dedupe_key, content_fingerprint
        )
        values (
          item->>'source',
          item->>'external_id',
          item->>'title',
          item->>'company',
          coalesce(item->>'description', ''),
          item->>'apply_url',
          nullif(item->>'source_url', ''),
          nullif(item->>'posted_at', '')::timestamptz,
          nullif(item->>'salary_text', ''),
          nullif(item->>'location_text', ''),
          coalesce((item->>'remote')::boolean, true),
          coalesce((item->>'remote_scope')::public.remote_scope, 'unknown'::public.remote_scope),
          coalesce(nullif(item->>'role_family', ''), 'other-tech'),
          coalesce(item->'tags', '[]'::jsonb),
          nullif(item->>'canonical_url', ''),
          nullif(item->>'dedupe_key', ''),
          nullif(item->>'content_fingerprint', '')
        );

        inserted_count := inserted_count + 1;
      exception when unique_violation then
        skipped_count := skipped_count + 1;
      end;
    end if;
  end loop;

  return query select inserted_count, updated_count, skipped_count;
end;
$$;

create or replace function public.finish_agent_task(
  p_task_id uuid,
  p_lease_token uuid,
  p_success boolean,
  p_error text default null,
  p_retry_delay_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if p_success then
    update public.agent_tasks
    set
      status = 'completed',
      completed_at = now(),
      last_error = null,
      lease_token = null,
      lease_expires_at = null
    where id = p_task_id
      and status = 'claimed'
      and lease_token = p_lease_token;
  else
    update public.agent_tasks
    set
      status = case when attempts >= max_attempts then 'blocked'::public.task_status else 'failed'::public.task_status end,
      last_error = p_error,
      available_at = now() + make_interval(secs => greatest(60, p_retry_delay_seconds)),
      lease_token = null,
      lease_expires_at = null
    where id = p_task_id
      and status = 'claimed'
      and lease_token = p_lease_token;
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
