-- 0039_campaign_extras.sql — extend public.campaigns with the columns the
-- DuckDB marketing store (apps/api/app/db/duckdb.py) tracked that the spine
-- table doesn't yet have. channels/theme (0010) and campaign_hashtags/color
-- (0014) already exist — not repeated here.

alter table public.campaigns
  add column if not exists post_count      integer not null default 0,
  add column if not exists published_count integer not null default 0,
  add column if not exists campaign_color  text,
  add column if not exists posting_time    text,
  add column if not exists vehicle         text,
  add column if not exists goal            text,
  add column if not exists selected_assets text,
  add column if not exists selected_logo   text,
  add column if not exists synced_at       timestamptz not null default now();
