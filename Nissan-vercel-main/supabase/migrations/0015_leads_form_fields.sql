-- 0015_leads_form_fields.sql
-- Adds fields captured from the "Book a test drive" web form.

alter table public.customers
  add column if not exists city text;

alter table public.leads
  add column if not exists budget_range text,
  add column if not exists test_drive_requested boolean,
  add column if not exists purchase_timeframe text,
  add column if not exists preferred_call_time text,
  add column if not exists preferred_channel text;
