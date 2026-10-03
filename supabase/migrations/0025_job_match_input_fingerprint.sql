alter table public.job_matches
  add column if not exists input_fingerprint text;

create index if not exists job_matches_profile_input_idx
  on public.job_matches(profile_id, input_fingerprint);
