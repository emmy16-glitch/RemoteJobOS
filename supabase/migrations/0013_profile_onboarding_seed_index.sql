create index if not exists profile_onboarding_seeds_claimed_by_idx
  on public.profile_onboarding_seeds(claimed_by)
  where claimed_by is not null;
