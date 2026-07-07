-- 0019_workflow_actions.sql — Workflow Agent (Phase 3).
-- Automatic decision engine: given a lead's score/classification/history,
-- decides the next action(s) (call, whatsapp, manager escalation, nurture,
-- close, test_drive) and persists the decision as an auditable record.

create table public.workflow_actions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  classification  text not null,                        -- hot | warm | cold | dead (leads.score at decision time)
  actions         jsonb not null default '[]'::jsonb,    -- e.g. ["call","whatsapp","manager_escalation"]
  reasoning       text,
  rule_matched    text not null,                          -- hot | warm | cold | dead | test_drive_override
  trigger_source  text not null,                          -- intake | manual | rescore | whatsapp_reply | call_intelligence
  escalated       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.workflow_actions (tenant_id, lead_id, created_at desc);

alter table public.workflow_actions enable row level security;
create policy workflow_actions_tenant on public.workflow_actions
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

-- New timeline event type for Workflow Agent decisions, additive per the
-- established pattern (0017's booked/delivered) — never drop/rename.
alter type lead_event_type add value if not exists 'workflow';

-- Catch-up fix: 'agent' and 'nba' have been used by the Follow-up Agent and
-- LeadTimeline.tsx since before this phase, but were never actually added
-- to the real Postgres enum (only the DuckDB shim's unconstrained VARCHAR
-- masked the gap). Same for lead_score's 'dead' bucket, used by the Scoring
-- Agent and ScoreBadge/SCORE_META in the frontend. Fixing here, while this
-- migration is already touching adjacent enums, rather than letting a 9th
-- silently-assumed-but-unmigrated value join the pile.
alter type lead_event_type add value if not exists 'agent';
alter type lead_event_type add value if not exists 'nba';
alter type lead_score add value if not exists 'dead';
