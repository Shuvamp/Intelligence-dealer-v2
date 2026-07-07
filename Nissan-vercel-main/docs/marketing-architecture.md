# Marketing Module — Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (Dealer User)                                  │
│                                                                                 │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │  Campaign    │  │  Content Studio │  │   Publishing  │  │   Marketing   │  │
│  │  Planner     │  │  (Poster + Copy)│  │   Dashboard   │  │   Dashboard   │  │
│  └──────┬───────┘  └────────┬────────┘  └───────┬───────┘  └───────┬───────┘  │
└─────────┼───────────────────┼───────────────────┼───────────────────┼──────────┘
          │                   │                   │                   │
          │        TanStack Start Server Functions (BFF)              │
          │        apps/web/src/lib/marketing.ts                      │
          ▼                   ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     TanStack Start (Node.js, :3000)                             │
│                                                                                 │
│  getCampaigns()      generatePosterImage()    approveCampaign()                 │
│  getMonthEvents()    generateDayContent()     approveEvent()                    │
│  getDuckCampaignDays() saveDayContent()       getPublishingQueue()              │
│  getAssets()         saveEventContent()       getMarketingOverview()            │
│                                                                                 │
│              ┌──────────────────────────────────┐                              │
│              │   analytics.duckdb.ts (proxy)     │                              │
│              │   All DuckDB ops → FastAPI /db/*  │                              │
│              └──────────────────┬───────────────┘                              │
└─────────────────────────────────┼───────────────────────────────────────────────┘
                                  │ HTTP (localhost:8000)
          ┌───────────────────────┼────────────────────────────────────┐
          │                       ▼                                    │
          │         FastAPI (Python, :8000)  apps/api/                 │
          │                                                            │
          │  ┌─────────────────────────────────────────────────────┐  │
          │  │              routers/marketing.py                   │  │
          │  │                                                     │  │
          │  │  /marketing/campaigns/plan ──────► Agent 1          │  │
          │  │  /marketing/content/generate ───► Agent 3          │  │
          │  │  /marketing/content/batch ──────► Agent 3 (batch)  │  │
          │  │  /marketing/poster/banner ──────► Agent 4          │  │
          │  │  /marketing/poster/regenerate ──► Agent 4 (force)  │  │
          │  │  /marketing/compliance/check ───► Agent 5          │  │
          │  │  /marketing/agents/publish ─────► Agent 6          │  │
          │  │  /marketing/copilot/ask ────────► Agent 8          │  │
          │  │  /marketing/calendar/month-plan ► Google iCal      │  │
          │  │  /marketing/campaigns/recommended► Rule-based       │  │
          │  └─────────────────────────────────────────────────────┘  │
          │                                                            │
          │  ┌─────────────────────────────────────────────────────┐  │
          │  │              AI Agents (LangGraph)                  │  │
          │  │                                                     │  │
          │  │  Agent 1 ─ campaign_planning.py  ─── GROQ LLM      │  │
          │  │  Agent 3 ─ content_generation.py ─── GROQ LLM      │  │
          │  │  Agent 4 ─ gemini.py             ─── Gemini Image  │  │
          │  │  Agent 5 ─ brand_compliance.py   ─── GROQ LLM      │  │
          │  │  Agent 6 ─ publishing.py         ─── GROQ LLM      │  │
          │  │  Agent 8 ─ marketing_copilot.py  ─── GROQ LLM      │  │
          │  └─────────────────────────────────────────────────────┘  │
          │                                                            │
          │  ┌─────────────────────────────────────────────────────┐  │
          │  │        services/auto_publisher.py                   │  │
          │  │        Background loop — polls every 60s            │  │
          │  │        queued → published when scheduled_at due     │  │
          │  └───────────────────────┬─────────────────────────────┘  │
          │                          │                                 │
          │  ┌─────────────────────────────────────────────────────┐  │
          │  │           db/duckdb.py  (.duckdb/analytics.duckdb)  │  │
          │  │                                                     │  │
          │  │   campaigns        campaign_days    opportunities   │  │
          │  │   campaign_posts   assets           publishing      │  │
          │  └─────────────────────────────────────────────────────┘  │
          │                                                            │
          │  ┌─────────────────────────────────────────────────────┐  │
          │  │      generated/posters/  (static file server)       │  │
          │  │      campaigns/{id}/day01_YYYY-MM-DD.jpg            │  │
          │  │      events/{YYYY-MM}/{date}_{name}.jpg             │  │
          │  └─────────────────────────────────────────────────────┘  │
          └────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
          ┌──────────────────┐          ┌────────────────────┐
          │  Supabase (hosted│          │  External APIs     │
          │  onjpgefydfbg…) │          │                    │
          │                 │          │  GROQ (LLM text)   │
          │  auth.users     │          │  Gemini (images)   │
          │  tenants        │          │  Google iCal       │
          │  RLS policies   │          │  Meta / Instagram  │
          └──────────────────┘          │  LinkedIn          │
                                        └────────────────────┘
```

---

## Data Flow: Campaign Creation → Publishing

```
User fills campaign brief
        │
        ▼
Agent 1 (Campaign Planner)
POST /marketing/campaigns/plan
        │  LangGraph → GROQ
        ▼
Day-by-day plan [date, theme, vehicle]
        │  saved to DuckDB campaigns + campaign_days
        ▼
Agent 3 (Content Generation) — auto-triggered on Content Studio open
POST /marketing/content/batch
        │  GROQ → headline, caption, hashtags, CTA per day
        ▼
Agent 4 (Poster) — on "Generate AI Poster" click
POST /marketing/poster/banner  (force_regenerate=true on regenerate)
        │  Gemini Image API
        │  car photo (from media library) + logo composited onto festive scene
        │  saved to generated/posters/campaigns/{id}/day{N}_{date}.jpg
        ▼
Agent 5 (Brand Compliance) — on "Check Compliance" click
POST /marketing/compliance/check
        │  GROQ → approved / flagged + reasons
        ▼
Human approves in Approval Queue
POST /db/publishing/approve-campaign
        │  status → queued, scheduled_at set
        ▼
Agent 7 (Auto-Publisher) — background, every 60s
        │  lists due posts from DuckDB
        │  calls Agent 6 (Publishing) per post
        ▼
Agent 6 (Publishing)
POST /marketing/agents/publish
        │  GROQ → simulates platform post
        │  status → published
        ▼
Published ✓ shown in Publishing Dashboard
```

---

## Data Flow: Monthly Events

```
User opens Content Studio → Monthly Events tab
        │
        ▼
getMonthEvents() server fn
        │  POST /marketing/calendar/month-plan (Google iCal → Calendarific → fallback)
        │  upsert to DuckDB opportunities (id = tenantId_date_name)
        │  batch content generation for pending events (Agent 3)
        ▼
Event list with headline/caption/hashtags pre-generated
        │
        ▼
User selects event, picks car photo + logo (Poster Assets panel)
        │
        ▼
Agent 4 (Poster) — same as campaign flow
POST /marketing/poster/banner
        │  path: events/{YYYY-MM}/{date}_{event_name}.jpg
        ▼
User approves → auto-publisher publishes
```

---

## Agent Registry

| # | Agent | Trigger | LLM | Output |
|---|-------|---------|-----|--------|
| 1 | Campaign Planning | User clicks "Generate Plan" | GROQ | Day plan array |
| 2 | Recommended Campaigns | Dashboard load | Rule-based | 4 suggestions |
| 3 | Content Generation | Auto on studio open / manual | GROQ | headline/caption/hashtags/CTA |
| 4 | Poster Generation | "Generate AI Poster" click | Gemini | JPG/PNG image |
| 5 | Brand Compliance | Manual check | GROQ | approved/flagged |
| 6 | Publishing | Auto-publisher trigger | GROQ | platform post simulation |
| 7 | Auto-Publisher | Cron 60s background loop | None | queued→published |
| 8 | Marketing Copilot | Copilot chat | GROQ | conversational answer |

---

## Multi-Tenant Isolation

```
Every DuckDB table has tenant_id column.
Supabase RLS: using (tenant_id = public.tenant_id())
Poster files: scoped by campaign_id (which includes tenant context via DB)
No cross-tenant data access possible at DB layer.
```
