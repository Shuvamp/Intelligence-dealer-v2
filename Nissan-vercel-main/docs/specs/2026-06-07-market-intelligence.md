# ADIP — Market Intelligence Module Spec (V1)

**Status:** Foundation scaffolded for team hand-off. Pages are TODO (the team builds them).
**Sits on:** spine + web shell + the Leads & Marketing modules' data. Plan gating: `intelligence`+.

## What this is
The **signals engine** — turns the dealership's own data into decisions. It reads leads,
campaigns/insights and customers and surfaces: lead-source performance, the pipeline funnel,
vehicle demand, regional demand, campaign ROI, plus a curated **signals** feed (demand / intent /
opportunity / trend / risk) and rule-based recommendations. Most of this is **real computed
analytics**, not mocked — the data already exists.

## Domain model
Mostly derived (computed in server functions). One owned table lets agents persist signals:

### `market_signals` — the signals feed (seeded; AI agents append later)
| column | type | notes |
|---|---|---|
| id · tenant_id → tenants | uuid | RLS boundary |
| kind | enum | demand, intent, opportunity, trend, risk |
| title · detail | text | |
| metric_label · metric_value | text | e.g. "SUV enquiries", "+23% WoW" |
| severity | enum | low, medium, high |
| source_module | text | leads / marketing / customers |
| status | enum | open, watching, actioned, dismissed |
| created_at · updated_at | timestamptz | |

Agents (registered in `agent_registry`, module='intelligence'): Demand Signal (seeded), Intent
Signal, Opportunity Detector, Trend Analyzer.

RLS: `tenant_id = public.tenant_id()`.

## Server functions (`src/lib/intelligence.ts`) — REAL aggregations over live data
- `getIntelligenceOverview()` → total leads, conversion rate, top source, top vehicle, open pipeline value, best campaign.
- `getLeadSourceAnalytics()` → per source: count, hot, won, conversion rate (from `leads`).
- `getPipelineFunnel()` → leads by stage in funnel order.
- `getVehicleDemand()` → leads grouped by `vehicle_interest` (count + hot), ranked.
- `getRegionalDemand()` → leads grouped by location (joined name), ranked.
- `getCampaignPerformance()` → `campaign_insights` × campaigns: reach, engagement, leads, CPL, conversion, simple ROI.
- `getSignals()` → `market_signals` ordered by severity then recency.
- `getTopRecommendations()` → rule-based opportunities derived from the analytics above.

## Pages the team builds
1. **Intelligence dashboard** (`/intelligence` index, replace placeholder) — overview stat bar, **Top Signals** (`getSignals`, use `SIGNAL_META`), **Top Recommendations**, lead-source bar/table, pipeline funnel, vehicle-demand and regional-demand charts.
2. **Campaign performance** — `getCampaignPerformance` table/cards with ROI + CPL.
3. (optional) **Signal detail / actioning** — mark a signal watching/actioned.

## Contract / design
Reuse `#/components/ui/kit` and `#/components/intelligence/intelligence-ui.tsx`
(SIGNAL_META by kind, SeverityBadge, TrendPill, StatTile, MiniBar). Mirror the Leads pages for
route/loader patterns. Charts: simple CSS/SVG bars are fine for V1 (no chart lib needed).

### Gotchas (same as the app)
- No `*.server.ts` server-fn files. Use `JsonValue` (not `unknown`) in return types.
- After mutations, `await router.invalidate()`. `#/` → `src/`. Tailwind v4. `var(--brand)`.

## Acceptance
Dashboard shows real numbers derived from seeded leads/campaigns; signals render; isolation holds. Verified in a browser.
