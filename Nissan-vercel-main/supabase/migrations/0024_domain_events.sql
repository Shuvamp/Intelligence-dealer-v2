-- 0024_domain_events.sql — Event-Driven Architecture (Phase 7).
-- The persisted log behind the in-process event bus: one row per published
-- domain event (LEAD_ASSIGNED, CALL_COMPLETED, LEAD_RESCORED, …). Makes the
-- agent mesh observable and recoverable — `status`/`attempts`/`error` track
-- handler dispatch, and unprocessed rows can be replayed on restart. Distinct
-- from `score_events` (Phase 6, rescore-specific) and `audit_logs` (record of
-- record). All tenant-scoped with RLS, mirrored into the DuckDB shim.

create table public.domain_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete cascade,   -- nullable: not every event is lead-scoped
  event_type   text not null,                                        -- lead_created | lead_assigned | call_completed | …
  payload      jsonb not null default '{}'::jsonb,
  source       text not null default 'system',                       -- producer that emitted it
  status       text not null default 'pending'
    check (status in ('pending', 'done', 'failed')),
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index on public.domain_events (tenant_id, event_type, created_at desc);
create index on public.domain_events (status) where status <> 'done';   -- replay scan
create index on public.domain_events (lead_id, created_at desc);

alter table public.domain_events enable row level security;
create policy domain_events_tenant on public.domain_events
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
