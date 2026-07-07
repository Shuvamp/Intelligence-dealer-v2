-- 0022_call_intelligence.sql — Call Intelligence Agent (Phase 5).
-- Stores uploaded sales-call recordings, transcripts (faster-whisper), sentiment,
-- and a single-LLM extraction (intent/competitors/timeline/recommended action).
-- Phase 5 PRODUCES insight only — it never mutates the lead score. The Dynamic
-- Re-Scoring Agent (Phase 6, Sriram) consumes call_analysis by call_id and owns
-- the score change + Workflow re-trigger. See PHASE_05_CALL_INTELLIGENCE.md.
-- All tenant-scoped with RLS, mirroring the DuckDB shim's initSchema().
-- ('call' is already a valid lead_event_type — no enum change needed.)

-- 1. call_recordings ──────────────────────────────────────────────────────────
create table public.call_recordings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  uploaded_by      uuid references public.users(id) on delete set null,
  file_name        text not null,
  recording_url    text,                       -- local path (dev) or storage URL (prod)
  duration_seconds integer,
  status           text not null default 'uploaded'
    check (status in ('uploaded', 'transcribing', 'analyzing', 'completed', 'failed')),
  error_reason     text,
  created_at       timestamptz not null default now()
);
create index on public.call_recordings (tenant_id, lead_id, created_at desc);

-- 2. call_transcripts ─────────────────────────────────────────────────────────
create table public.call_transcripts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  call_id           uuid not null references public.call_recordings(id) on delete cascade,
  transcript        text not null,
  language_detected text,
  created_at        timestamptz not null default now()
);
create index on public.call_transcripts (call_id);

-- 3. call_sentiment ───────────────────────────────────────────────────────────
create table public.call_sentiment (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  call_id    uuid not null references public.call_recordings(id) on delete cascade,
  sentiment  text not null check (sentiment in ('positive', 'neutral', 'negative')),
  confidence real,
  created_at timestamptz not null default now()
);
create index on public.call_sentiment (call_id);

-- 4. call_analysis ────────────────────────────────────────────────────────────
-- Keyed 1:1 to a call (unique call_id) so a re-analysis UPDATEs in place rather
-- than inserting a duplicate — this is what makes Phase 6's re-score idempotent.
create table public.call_analysis (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  call_id             uuid not null unique references public.call_recordings(id) on delete cascade,
  customer_summary    jsonb not null default '[]'::jsonb,
  interest_level      text,                    -- high | medium | low
  buying_intent_score integer,                 -- 0-100
  competitors         jsonb not null default '[]'::jsonb,
  competitor_risk     text,                    -- none | low | medium | high
  price_sensitivity   text,                    -- low | medium | high
  purchase_timeline   text,                    -- immediate | 30_days | 90_days | unknown
  test_drive_interest boolean,
  followup_requested  boolean,
  recommended_action  text,
  reasoning           jsonb not null default '[]'::jsonb,
  raw_analysis        jsonb,
  created_at          timestamptz not null default now()
);
create index on public.call_analysis (tenant_id, call_id);

-- RLS — same tenant-isolation pattern as every other lead-module table.
alter table public.call_recordings  enable row level security;
alter table public.call_transcripts enable row level security;
alter table public.call_sentiment   enable row level security;
alter table public.call_analysis    enable row level security;

create policy call_recordings_tenant on public.call_recordings
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy call_transcripts_tenant on public.call_transcripts
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy call_sentiment_tenant on public.call_sentiment
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
create policy call_analysis_tenant on public.call_analysis
  for all to authenticated
  using (tenant_id = public.tenant_id()) with check (tenant_id = public.tenant_id());
