-- 0057_instagram_post_saved_shares.sql
--
-- Saves/shares from /{media-id}/insights, alongside 0054's reach/impressions —
-- completes per-post Post Performance metrics. Nullable: not every media type
-- reports these, and a token without instagram_manage_insights returns nothing.

alter table public.instagram_post_metrics
  add column if not exists saved  int,
  add column if not exists shares int;
