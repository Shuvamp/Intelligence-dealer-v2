-- 0037_youtube_channel.sql — add YouTube as a supported social channel
--
-- YouTube is the first channel needing OAuth token refresh (LinkedIn's 60-day
-- token and Instagram's long-lived token don't refresh today), so
-- refresh_token/token_expires_at are added as channel-agnostic columns any
-- future channel can reuse — not youtube-prefixed.

alter table public.social_channel_connections
  drop constraint social_channel_connections_channel_check;

alter table public.social_channel_connections
  add constraint social_channel_connections_channel_check
  check (channel in ('instagram', 'facebook', 'google_business', 'whatsapp', 'linkedin', 'youtube'));

alter table public.social_channel_connections
  add column if not exists youtube_channel_id text,
  add column if not exists youtube_channel_name text,
  add column if not exists refresh_token text,
  add column if not exists token_expires_at timestamptz;

create table public.youtube_videos (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  video_id         text not null,
  video_url        text not null,
  title            text,
  description      text,
  privacy_status   text,
  published_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (tenant_id, video_id)
);
create index on public.youtube_videos (tenant_id);

alter table public.youtube_videos enable row level security;

create policy youtube_videos_tenant on public.youtube_videos
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
