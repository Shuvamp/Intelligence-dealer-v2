-- 0043_channel_connections_gapfill.sql — add columns the local SQLite
-- channel store (apps/api/app/services/channel_store.py _COLUMNS) tracks
-- that never made it into a Supabase migration. Without these, connecting a
-- channel silently drops the account's display name/avatar/profile link.

alter table public.social_channel_connections
  add column if not exists email        text,
  add column if not exists picture      text,
  add column if not exists profile_url  text;
