-- 0048_campaign_second_logo.sql — allow a campaign to carry a second logo
-- (e.g. dealer logo top-left + Nissan brand logo top-right on posters).
-- Mirrors selected_logo (0041); stored as a JSON string like selected_logo.

alter table public.campaigns
  add column if not exists selected_logo_2 text;
