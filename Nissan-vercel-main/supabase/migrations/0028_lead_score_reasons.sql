-- 0028_lead_score_reasons.sql — persist scoring agent explainability fields.
-- The intake pipeline produces score_reasons (the "AI reasoning / Why this
-- score" bullets), scored_by (which engine scored — claude_holistic/groq/…),
-- and score_notice (fallback banner text). These existed only in the DuckDB
-- shim's leads table, never in Supabase — so on real Supabase the intake PATCH
-- had nowhere to write them and the lead detail page showed no AI reasoning.
-- Additive, nullable. score_reasons is jsonb so PostgREST returns a JS array.
alter table public.leads add column if not exists score_reasons jsonb   default '[]'::jsonb;
alter table public.leads add column if not exists scored_by     text;
alter table public.leads add column if not exists score_notice  text;
