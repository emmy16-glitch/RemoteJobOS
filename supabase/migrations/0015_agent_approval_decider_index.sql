create index if not exists agent_approvals_decided_by_idx
  on public.agent_approvals(decided_by)
  where decided_by is not null;
