-- PostgREST upserts need a non-partial unique target for on_conflict.
-- PostgreSQL UNIQUE indexes still allow multiple NULL values, so the predicate
-- from migration 0003 is unnecessary.

drop index if exists public.agent_tasks_idempotency_unique;

create unique index agent_tasks_idempotency_unique
  on public.agent_tasks(idempotency_key);

comment on index public.agent_tasks_idempotency_unique is
  'Prevents duplicate logical tasks while allowing multiple rows with NULL idempotency keys.';
