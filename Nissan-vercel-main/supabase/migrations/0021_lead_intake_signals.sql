-- 0020_lead_intake_signals.sql — Enquiry-form scoring-signal fields.
-- The website enquiry form (/enquire) now captures four extra high-signal
-- answers that feed the scoring agent's weakest first-touch dimensions
-- (financial_readiness, relationship_strength, competitive_risk, urgency) and
-- are surfaced back on the lead detail "Key facts" panel. Additive, nullable —
-- existing rows are unaffected. Mirrors the columns added to the DuckDB shim's
-- leads table (apps/local-api/server.js).

alter table public.leads add column if not exists financing            text;  -- cash | pre_approved | loan_needed | unsure
alter table public.leads add column if not exists nissan_relationship  text;  -- current_owner | past_owner | referred | new
alter table public.leads add column if not exists brand_consideration  text;  -- only_nissan | comparing
alter table public.leads add column if not exists comparing_brands      text;  -- free text rivals when brand_consideration = comparing
alter table public.leads add column if not exists purchase_reason       text;  -- replacement | occasion | business | first_car | researching
