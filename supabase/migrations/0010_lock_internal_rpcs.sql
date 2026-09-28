revoke all on function public.claim_agent_task(text, text[], integer) from public, anon, authenticated;
revoke all on function public.can_submit_application(uuid) from public, anon, authenticated;
revoke all on function public.ingest_discovered_jobs(jsonb) from public, anon, authenticated;
revoke all on function public.finish_agent_task(uuid, uuid, boolean, text, integer) from public, anon, authenticated;
revoke all on function public.record_job_source_run(text, boolean, integer, integer, text) from public, anon, authenticated;

grant execute on function public.claim_agent_task(text, text[], integer) to service_role;
grant execute on function public.can_submit_application(uuid) to service_role;
grant execute on function public.ingest_discovered_jobs(jsonb) to service_role;
grant execute on function public.finish_agent_task(uuid, uuid, boolean, text, integer) to service_role;
grant execute on function public.record_job_source_run(text, boolean, integer, integer, text) to service_role;
