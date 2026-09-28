alter type public.application_status add value if not exists 'auto-submit-queued';
alter type public.application_status add value if not exists 'needs-attention';
