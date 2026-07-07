-- Phase 6: Dynamic Re-Scoring
-- Two new tables: lead_score_history (immutable audit trail of every score
-- change) and score_events (raw trigger log that feeds the re-scoring agent).
--
-- Phase 5 dependency note: call_recordings/call_transcripts/call_sentiment
-- tables will be added by Phase 5. This migration is fully independent of them.
-- The re-scoring agent accepts a "call_completed" trigger and a `call_sentiment`
-- payload field; both are no-ops until Phase 5 populates them.

-- ── lead_score_history ────────────────────────────────────────────────────────
-- One row per score change. Never mutated — append-only audit trail.
-- Mirrors the pattern of message_delivery_logs (0020_whatsapp.sql).

create table public.lead_score_history (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  score           text not null check (score in ('hot','warm','cold','dead')),
  score_value     integer not null default 0,
  previous_score  text check (previous_score in ('hot','warm','cold','dead')),
  previous_value  integer,
  -- Which event caused this re-score (whatsapp_replied|test_drive_booked|
  -- call_completed|stage_change|manual|lead_activity|intake)
  trigger         text not null,
  -- Which scoring path was used (claude|groq|groq_backup|nvidia|deterministic)
  scored_by       text,
  score_reasons   jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index lead_score_history_lead_idx on public.lead_score_history (lead_id, created_at desc);

alter table public.lead_score_history enable row level security;
create policy score_history_tenant on public.lead_score_history
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());

-- ── score_events ──────────────────────────────────────────────────────────────
-- Raw event log: every trigger that caused (or could cause) a re-score.
-- The agent marks rows processed=true after completing the re-score run.

create table public.score_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  -- Trigger vocabulary: whatsapp_replied|test_drive_booked|call_completed|
  --   stage_change|manual|lead_activity|email_opened|manager_interaction
  event_type  text not null,
  -- Arbitrary trigger context (e.g. {"call_sentiment": "positive"} from Phase 5,
  -- or {"to_stage": "test_drive"} from stage changes).
  metadata    jsonb not null default '{}'::jsonb,
  processed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index score_events_lead_idx  on public.score_events (lead_id, created_at desc);
create index score_events_unproc_idx on public.score_events (lead_id) where processed = false;

alter table public.score_events enable row level security;
create policy score_events_tenant on public.score_events
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
