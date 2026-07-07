-- 0027_lead_intake_patch_fields.sql — intake pipeline PATCH fields.
-- The FastAPI intake endpoint (POST /intake/leads) PATCHes these normalized
-- fields onto the lead after scoring/assignment. They existed only in the
-- DuckDB shim's leads table (apps/local-api/server.js), never in Supabase — so
-- on real Supabase the PATCH hit unknown columns and PostgREST rejected the
-- WHOLE update, silently dropping the score AND assignment. Additive, nullable.
alter table public.leads add column if not exists test_drive_required    boolean default false;
alter table public.leads add column if not exists purchase_timeline_days  integer;
alter table public.leads add column if not exists callback_within_days    integer;
alter table public.leads add column if not exists contact_medium          text;
