-- Migration 0036 — Marketing budget category benchmarks.
-- Baseline monthly marketing spend (INR) per business category, consumed by the
-- Marketing Budget Planner (apps/api/agents/marketing_budget_planner). Previously
-- these figures were hardcoded in budget.py; moving them to a table makes them
-- editable without a code deploy and lets ops tune them against real data.
--
-- This is GLOBAL reference/lookup data, not tenant-owned domain data, so it has no
-- tenant_id (it is intentionally exempt from the "every domain table has tenant_id"
-- rule). Readable by any authenticated user; the planner reads it with the service
-- key. `category_key` is a lowercase substring matched against a company's industry;
-- `sort_order` fixes match precedence (more specific keys first). If no key matches,
-- the planner falls back to a code-level default.
create table if not exists public.marketing_budget_benchmarks (
    id            uuid primary key default gen_random_uuid(),
    category_key  text not null unique,
    base_inr      integer not null check (base_inr > 0),
    sort_order    integer not null default 100,
    label         text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists marketing_budget_benchmarks_order_idx
    on public.marketing_budget_benchmarks (sort_order);

alter table public.marketing_budget_benchmarks enable row level security;
create policy marketing_budget_benchmarks_read on public.marketing_budget_benchmarks
    for select to authenticated using (true);

-- Seed with the figures previously hardcoded in budget.py (same order/precedence).
insert into public.marketing_budget_benchmarks (category_key, base_inr, sort_order, label) values
    ('automotive dealership', 150000,  1, 'Automotive dealership'),
    ('dealership',            150000,  2, 'Dealership'),
    ('automotive',           150000,  3, 'Automotive'),
    ('ecommerce',            120000,  4, 'E-commerce'),
    ('e-commerce',           120000,  5, 'E-commerce'),
    ('retail',               100000,  6, 'Retail'),
    ('real estate',          130000,  7, 'Real estate'),
    ('hospitality',           90000,  8, 'Hospitality'),
    ('healthcare',           110000,  9, 'Healthcare'),
    ('education',             80000, 10, 'Education'),
    ('services',              80000, 11, 'Services')
on conflict (category_key) do nothing;
