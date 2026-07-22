-- 0055_campaign_insights_reach.sql
--
-- Extends 0053's rollup: now that the poller stores per-post reach/impressions
-- (0054), carry them into public.campaign_insights instead of leaving the
-- columns at their 0 defaults.
--
-- Posts whose insights Instagram didn't report (no scope yet, or reels, which
-- have no `impressions`) contribute NULL, which sum() skips — so a campaign
-- shows the reach it can actually account for, never an invented number.
-- leads_generated / conversions / spend stay 0: no Instagram signal maps to them.

create or replace function public.refresh_campaign_insights_from_instagram(p_tenant uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows int;
begin
  drop table if exists _ci_ig;
  create temp table _ci_ig as
  with attributed as (
    select distinct on (p.media_id)
           p.media_id,
           c.id as campaign_id
      from public.instagram_posts p
      join public.campaigns c
        on c.tenant_id  = p.tenant_id
       and c.start_date is not null
       and p.published_at::date between c.start_date
                                    and coalesce(c.end_date, current_date)
     where p.tenant_id = p_tenant
     order by p.media_id, c.start_date desc, c.created_at desc
  ),
  daily as (
    -- likes/comments/reach are lifetime counters, so one day = that day's LAST
    -- snapshot, not the sum of every poll tick.
    select distinct on (m.media_id, m.captured_at::date)
           m.media_id,
           m.captured_at::date as day,
           coalesce(m.likes, 0) + coalesce(m.comments, 0) as engagement,
           m.reach,
           m.impressions
      from public.instagram_post_metrics m
     where m.tenant_id = p_tenant
       and m.status in ('ok', 'unavailable')
       and (m.likes is not null or m.comments is not null
            or m.reach is not null or m.impressions is not null)
     order by m.media_id, m.captured_at::date, m.captured_at desc
  )
  select a.campaign_id,
         d.day,
         sum(d.engagement)::int          as engagement,
         coalesce(sum(d.reach), 0)::int       as reach,
         coalesce(sum(d.impressions), 0)::int as impressions
    from daily d
    join attributed a on a.media_id = d.media_id
   group by a.campaign_id, d.day;

  delete from public.campaign_insights ci
   using _ci_ig t
   where ci.tenant_id   = p_tenant
     and ci.campaign_id = t.campaign_id
     and ci.captured_at::date = t.day;

  insert into public.campaign_insights
    (tenant_id, campaign_id, engagement, reach, impressions, captured_at)
  select p_tenant, t.campaign_id, t.engagement, t.reach, t.impressions, t.day::timestamptz
    from _ci_ig t;
  get diagnostics v_rows = row_count;

  drop table if exists _ci_ig;
  return v_rows;
end;
$$;

revoke execute on function public.refresh_campaign_insights_from_instagram(uuid) from public;
grant  execute on function public.refresh_campaign_insights_from_instagram(uuid) to service_role;
