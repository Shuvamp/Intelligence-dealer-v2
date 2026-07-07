-- 0016_linkedin_channel.sql — add LinkedIn as a supported social channel

-- Extend check constraint to include linkedin
alter table public.social_channel_connections
  drop constraint social_channel_connections_channel_check;

alter table public.social_channel_connections
  add constraint social_channel_connections_channel_check
  check (channel in ('instagram', 'facebook', 'google_business', 'whatsapp', 'linkedin'));

-- Store LinkedIn member ID (sub from /userinfo)
alter table public.social_channel_connections
  add column if not exists linkedin_id text;
