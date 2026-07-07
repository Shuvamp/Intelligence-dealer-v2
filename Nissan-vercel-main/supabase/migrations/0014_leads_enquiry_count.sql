-- 0014_leads_enquiry_count.sql
-- Tracks how many times the same lead (by phone) has been submitted.
-- Used by the lead validation agent to detect duplicates without blocking re-enquiries.

alter table public.leads
  add column enquiry_count int not null default 1;
