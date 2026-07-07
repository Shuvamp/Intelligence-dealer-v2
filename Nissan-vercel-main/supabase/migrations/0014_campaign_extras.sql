-- 0014_campaign_extras.sql — Add color and campaign-level hashtags to campaigns.
alter table public.campaigns
  add column color             text,
  add column campaign_hashtags text[] not null default '{}';
