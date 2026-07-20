-- campaign_posts gapfill: columns the web-local DuckDB shim's richer schema
-- had (headline/subheadline/poster_provider/compliance_score/rejection_reason)
-- but the real Supabase table (0010_marketing.sql) never got. Needed so
-- generateContent's draft-post writes land in the same table
-- runCompliance/approvePost/etc. already read from.
alter table public.campaign_posts
  add column if not exists headline text,
  add column if not exists subheadline text,
  add column if not exists poster_provider text,
  add column if not exists compliance_score integer,
  add column if not exists rejection_reason text;
