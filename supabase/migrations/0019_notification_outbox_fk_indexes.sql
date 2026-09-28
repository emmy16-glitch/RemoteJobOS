create index if not exists notification_outbox_application_idx
  on public.notification_outbox(application_id)
  where application_id is not null;

create index if not exists notification_outbox_exception_idx
  on public.notification_outbox(exception_id)
  where exception_id is not null;
