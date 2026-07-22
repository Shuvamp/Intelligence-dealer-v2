-- 0054_instagram_post_reach.sql
--
-- Per-post reach/impressions from /{media-id}/insights (needs the
-- instagram_manage_insights scope, added to app/services/instagram.py SCOPES —
-- existing connections must reconnect Instagram to get a token that carries it).
--
-- Nullable on purpose: Instagram doesn't expose `impressions` for reels, and a
-- token without the scope returns nothing at all. NULL = "not reported"; 0 would
-- claim nobody saw the post.

alter table public.instagram_post_metrics
  add column if not exists reach       int,
  add column if not exists impressions int;
