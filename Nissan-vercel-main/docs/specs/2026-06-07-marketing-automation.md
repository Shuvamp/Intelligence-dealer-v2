# ADIP — Marketing Intelligence Module Spec (V1)

**Status:** Foundation scaffolded for team hand-off. Pages are TODO (the team builds them).
**Sits on:** the spine (Tier 1) + web shell (Tier 3) + Agent Registry. Plan gating: `growth`+ (spine §6).

## What this is
**Not a social scheduler — a multi-agent marketing command center.** A dealer picks a month and
the system returns a full plan: campaign calendar, festival/regional opportunities, offer
suggestions, posters, captions, hashtags, publishing recommendations, and performance insights.
The user sees one workflow; internally specialized agents collaborate. Goal: marketing planning
from days → minutes. Marketing feeds the top of the funnel that Lead Management works.

## Agent architecture (registered in `agent_registry`, module = `marketing`)
| # | Agent | agent_type | Phase 1 | Output |
|---|---|---|---|---|
| 1 | Campaign Planning | advisor | **real** (festival/holiday/regional calendar dataset) | 30-day campaign calendar with themes |
| 2 | Marketing Strategy | advisor | basic | campaigns prioritized by business impact (push Magnite, SUV segment…) |
| 3 | Content Generation | generator | functional stub → Claude | captions, descriptions, hashtags, CTA |
| 4 | Creative Poster | generator | functional stub → image model | poster concepts + prompt + template |
| 5 | Brand Compliance | analyzer | basic rule checks | approved / flagged creative |
| 6 | Publishing | automation | **mocked** | publishing schedule (no real channel push yet) |
| 7 | Campaign Insight | analyzer | **seeded data** | scorecard: reach, engagement, leads, CPL, conversion |
| 8 | Marketing Copilot | copilot | basic | NL answers ("which campaign should I run next?") |

The seam for "real": each agent is a server function with a stub body marked
`// AGENT STUB → swap for Claude/LangGraph`. Signatures stay; only the body changes.

## Domain model (module-owned; FK to spine)

### `campaigns` — the plan/container
| column | type | notes |
|---|---|---|
| id | uuid pk · tenant_id → tenants · location_id → locations | RLS boundary |
| name | text | "Independence Day SUV Drive" |
| theme | text | festival/occasion the campaign is built around |
| objective | enum | awareness, lead_gen, offer, festival, launch |
| status | enum | draft, scheduled, active, completed, archived |
| channels | text[] | facebook, instagram, google_business |
| start_date / end_date | date | |
| budget | numeric · created_by → users · created_at / updated_at | |

### `campaign_posts` — content (Content + Poster agent output; approval + publish unit)
| column | type | notes |
|---|---|---|
| id · tenant_id · campaign_id → campaigns (null) | uuid | |
| title · caption · cta | text | Content Generation Agent |
| hashtags | text[] | Content Generation Agent |
| channel | enum | facebook, instagram, google_business, whatsapp |
| status | enum | draft, pending_approval, approved, scheduled, published, rejected |
| compliance | enum | unchecked, approved, flagged (Brand Compliance Agent) |
| vehicle · offer | text | |
| poster_url | text (null) | Creative Poster Agent (null → UI renders a generated placeholder) |
| poster_prompt | text (null) | the image prompt the poster agent produced |
| scheduled_at / published_at | timestamptz (null) | Publishing Agent |
| approved_by / created_by → users (null) · created_at / updated_at | | |

### `campaign_insights` — Campaign Insight Agent scorecard (seeded in V1)
| column | type | notes |
|---|---|---|
| id · tenant_id · campaign_id → campaigns | uuid | |
| reach · impressions · engagement · leads_generated · conversions | int | |
| spend · cost_per_lead · conversion_rate | numeric | |
| captured_at | timestamptz | |

RLS: `tenant_id = public.tenant_id()` on all three (spine pattern).

## Server functions (the frozen contract — `src/lib/marketing.ts`)
**Reads**
- `getMarketingOverview()` → command-center stats: active campaigns, content in pipeline, pending approval, posts published (30d), leads attributed, blended cost-per-lead.
- `getMonthPlan({ month })` → **Campaign Planning Agent (real):** festivals, holidays, regional events, dealership occasions + recommended themes for that month. Deterministic dataset.
- `getRecommendedCampaigns()` → **Marketing Strategy Agent:** prioritized campaign ideas with rationale.
- `getCampaigns()` / `getCampaign({id})` → campaigns (+ post counts, status) / one campaign + posts + insights.
- `getContentCalendar()` → scheduled posts for the calendar view (campaign + channel + status).
- `getApprovalQueue()` → posts pending approval (+ compliance flag).
- `getCampaignScorecard({id})` → Insight Agent scorecard (seeded).
- `marketingCopilot({ question })` → basic NL recommendation over campaigns/insights.

**Mutations**
- `createCampaign({...})`
- `generateContent({ campaign_id?, channel, vehicle, offer?, objective?, theme? })` → **Content Generation Agent (stub):** returns caption + hashtags + CTA, creates a `campaign_posts` draft.
- `generatePoster({ post_id })` → **Creative Poster Agent (stub):** sets poster_prompt + poster_url placeholder.
- `runCompliance({ post_id })` → **Brand Compliance Agent:** sets `compliance` to approved/flagged via rule checks.
- `submitForApproval({id})` · `approvePost({id})` · `rejectPost({id})`
- `schedulePost({ id, scheduled_at })` · `publishPost({id})` → **Publishing Agent (mocked):** marks published, no real channel push.

## Pages the team builds (UI is NOT scaffolded)
1. **Marketing command center** (`/marketing` index) — overview stats, AI-recommended campaigns (Strategy Agent), content pipeline, upcoming/published, AI marketing recommendations (Copilot). "Feels like a command center, not a scheduler."
2. **Month Planner** — pick a month → `getMonthPlan` festivals/events + one-click "create campaign from opportunity".
3. **Poster / Caption Generator** — vehicle/channel/offer/theme → `generateContent` + `generatePoster`; preview poster + caption + hashtags; run compliance; submit for approval.
4. **Campaign Calendar** — `getContentCalendar`, chips by channel/status.
5. **Approval Queue** — approve/reject/schedule/publish; compliance flags.
6. **Campaign Scorecard** — `getCampaignScorecard` (reach, engagement, leads, CPL, conversion) + lead attribution.

## Design / contract for the UI team
Reuse `#/components/ui/kit` and the new `#/components/marketing/marketing-ui.tsx`
(ChannelIcon/ChannelTag, PostStatusBadge, ComplianceBadge, ObjectiveBadge, CAMPAIGN_STATUS_META,
AgentTag). Follow the Leads module exactly for route/loader/mutation patterns.

### Gotchas (do NOT relearn the hard way)
- Server-fn files must NOT be `*.server.ts` (TanStack mocks them on the client). Use `src/lib/marketing.ts`.
- `unknown`/jsonb in a server-fn return breaks its type — use `JsonValue` from `#/lib/types`.
- After a mutation, `await router.invalidate()` to refresh; never `router.navigate` to the same page (aborts in-flight RPCs).
- `#/` → `src/`. Tailwind v4 only-valid-classes. Brand accent via `var(--brand)`.

## Acceptance (team's done)
Month planner returns real festival/event opportunities; generating content creates a draft with
caption + hashtags; compliance/approve/schedule/publish move status and persist; scorecard renders
seeded insights; isolation holds (XYZ sees only XYZ). Verified in a browser.
