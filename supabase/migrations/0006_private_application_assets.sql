insert into storage.buckets (id, name, public)
values ('application-assets', 'application-assets', false)
on conflict (id) do update set public = false;

comment on table public.cv_versions is
  'Verified-fact CV plans. storage_path points to a private application-assets object when rendered.';
