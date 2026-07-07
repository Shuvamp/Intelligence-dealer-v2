# ADIP — Marketing Module Spec

**Date:** 2026-06-10
**Status:** Active development (Phase 1)
**Plan gating:** `growth`+ (starter excluded)
**Route prefix:** `/marketing/*`
**Server functions:** `apps/web/src/lib/marketing.ts`
**Types:** `apps/web/src/lib/types.ts`
**UI kit:** `apps/web/src/components/marketing/`

---

## 1. Purpose

Multi-agent marketing command center for Nissan dealerships. A dealer picks a month and the system returns a full marketing plan: campaign calendar, festival/regional opportunities, offer suggestions, poster creative, captions, hashtags, publishing schedule, and performance insights. Goal: marketing planning from days → minutes.

Marketing feeds the top of the funnel that Lead Management works.

---

## 2. Pages (route → component → status)

| Route | Component | Status |
|---|---|---|
| `/marketing` | redirect → `/marketing/dashboard` | Done |
| `/marketing/dashboard` | Marketing Dashboard | Done |
| `/marketing/campaign-planner` | Campaign Planner | Done |
| `/marketing/content-studio` | Content Studio | Done |
| `/marketing/compliance-center` | Compliance Center | Done |
| `/marketing/approval-queue` | Approval Queue | Done |
| `/marketing/media-library` | Media Library | Done |
| `/marketing/connected-channels` | Connected Channels | Done |
| `/marketing/publishing` | Publishing | Done |

---

## 3. Agent Architecture

Eight agents registered in `agent_registry` (module = `marketing`):

| # | Agent | agent_type | Phase 1 impl | Output |
|---|---|---|---|---|
| 1 | Campaign Planning | advisor | **Real** — Calendarific API (IN) + CALENDAR fallback | 30-day calendar with festival/holiday/regional/dealership opportunities |
| 2 | Marketing Strategy | advisor | Basic | Prioritized campaign ideas with rationale (push Magnite, SUV, etc.) |
| 3 | Content Generation | generator | Claude when `ANTHROPIC_API_KEY` set; template fallback otherwise | Caption, headline, subheadline, hashtags, CTA |
| 4 | Creative Poster | generator | NVIDIA Cosmos/SDXL when keyed; prompt-only stub otherwise | `poster_prompt` + `poster_image_url` |
| 5 | Brand Compliance | analyzer | Rule-based (8 Nissan rules, scoring) | `compliance` = approved / flagged + score |
| 6 | Publishing | automation | Mocked (status flip only, no real channel push) | Sets `published_at` |
| 7 | Campaign Insight | analyzer | Seeded data from `campaign_insights` | Reach, engagement, leads, CPL, conversion |
| 8 | Marketing Copilot | copilot | Basic NL over campaigns/insights | Recommendations |

Seam for "real" agents: each is a server function with an `// AGENT STUB → swap for Claude/LangGraph` block. Signatures stay the same so UI never changes.

---

## 4. Domain Model

All tables carry `tenant_id`. RLS: `tenant_id = public.tenant_id()`.

### `campaigns`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid → tenants | RLS boundary |
| location_id | uuid → locations | |
| name | text | |
| theme | text | occasion the campaign is built around |
| objective | enum | awareness, lead_gen, offer, festival, launch |
| status | enum | draft, scheduled, active, completed, archived |
| channels | text[] | facebook, instagram, google_business, whatsapp |
| start_date / end_date | date | |
| budget | numeric | |
| notes | text | |
| color | text | hex, used in calendar view |
| created_by | uuid → users | |

### `campaign_posts`
Content and poster unit. One per channel per day (roughly).

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id / campaign_id | uuid | |
| title / caption / cta | text | Content Generation Agent output |
| headline / subheadline | text | banner copy |
| hashtags | text[] | |
| channel | enum | facebook, instagram, google_business, whatsapp |
| status | enum | draft, pending_approval, approved, scheduled, published, rejected |
| compliance | enum | unchecked, approved, flagged |
| compliance_score | int | 0–100 |
| vehicle / offer | text | |
| poster_url | text (null) | real image URL when Creative Poster Agent runs |
| poster_image_url | text (null) | NVIDIA-generated image |
| poster_prompt | text (null) | image generation prompt |
| scheduled_at / published_at | timestamptz | |
| approved_by / rejected_by / rejection_reason | | |
| created_by | uuid → users | |

### `campaign_insights`
Campaign Insight Agent scorecard (seeded in V1, agents append later).

| column | type | notes |
|---|---|---|
| id · tenant_id · campaign_id | uuid | |
| reach · impressions · engagement · leads_generated · conversions | int | |
| spend · cost_per_lead · conversion_rate | numeric | |
| captured_at | timestamptz | |

### `campaign_days` (DuckDB — analytics layer)
Per-day campaign breakdown for the calendar view. Stored in DuckDB, not Supabase.

| column | type |
|---|---|
| campaign_id | text |
| tenant_id | text |
| date | text (YYYY-MM-DD) |
| day_num | int |
| theme | text |
| vehicle | text |

---

## 5. Server Functions (frozen contract)

All in `apps/web/src/lib/marketing.ts`. Call from client: `await fn({ data: { ... } })`.

### Reads
| Function | Returns |
|---|---|
| `getMarketingOverview()` | `MarketingOverview` — activeCampaigns, contentInPipeline, pendingApproval, publishedThisMonth, leadsAttributed, costPerLead |
| `getMonthPlan({ month, year })` | `MonthPlan` — opportunities array (festival/holiday/regional/dealership from Calendarific) |
| `getRecommendedCampaigns()` | `RecommendedCampaign[]` — Strategy Agent prioritized ideas |
| `getCampaigns()` | `CampaignSummary[]` |
| `getCampaign({ id })` | `Campaign` + posts + insights |
| `getContentCalendar()` | `CampaignPost[]` — scheduled posts for calendar view |
| `getApprovalQueue()` | `CampaignPost[]` — all posts (filtered client-side by status tab) |
| `getCampaignScorecard({ id })` | `CampaignScorecard` |
| `marketingCopilot({ question })` | `string` |
| `getDuckCampaigns()` | `CampaignSummary[]` from DuckDB |
| `getDuckCampaignDays()` | `CampaignDay[]` from DuckDB |
| `getMediaAssets()` | `MediaAsset[]` |
| `getChannelStatus()` | `ChannelConnection[]` |
| `getCampaignPosts({ campaign_id })` | `CampaignPost[]` for a single campaign |

### Mutations
| Function | Effect |
|---|---|
| `createCampaign({ ...CampaignPlanInput })` | Creates campaign + writes to DuckDB |
| `deleteCampaign({ id })` | Deletes campaign + removes DuckDB rows |
| `generateContent({ campaign_id?, channel, vehicle, offer?, objective?, theme? })` | Content Agent: creates `campaign_posts` draft, returns content + post id |
| `generatePoster({ post_id, theme? })` | Poster Agent: sets poster_prompt + calls NVIDIA if keyed, returns poster_image_url |
| `runCompliance({ post_id })` | Compliance Agent: runs 8 Nissan rules, sets compliance + score |
| `submitForApproval({ id })` | Moves status → pending_approval |
| `approvePost({ id })` | Moves status → approved |
| `rejectPost({ id, reason? })` | Moves status → rejected |
| `requestChangesPost({ id, feedback })` | Moves status → draft + stores feedback |
| `schedulePost({ id, scheduled_at })` | Sets scheduled_at → status = scheduled |
| `publishPost({ id })` | Publishing Agent (mocked): sets published_at → status = published |
| `uploadMediaAsset({ ... })` | Stores asset metadata |

After every mutation: `await router.invalidate()`. Never `router.navigate()` to same page.

---

## 6. Pages — Detail

### 6.1 Marketing Dashboard (`/marketing/dashboard`)
**Purpose:** Command center overview. First screen after clicking Marketing in nav.

**Data:** `getMarketingOverview` + `getCampaigns` + `getApprovalQueue`

**Layout:**
- Header: title + "New Campaign" CTA → campaign planner
- 6-up KPI cards: Active Campaigns, Pending Approvals (warning if >0), Published Posts (30d), Content in Pipeline, Leads Attributed, Cost/Lead
- AI Agent Pipeline: horizontal flow visualization showing the 6 stages (Campaign Planner → Content Creation → Brand Compliance → Human Approval → Published → Analytics), each linking to its page
- Active Campaigns list (top 5, links to campaign planner)
- Approval Queue summary (top 3 pending, "Review All" CTA)

---

### 6.2 Campaign Planner (`/marketing/campaign-planner`)
**Purpose:** Visual monthly calendar. See festival/holiday opportunities, plan campaigns, create campaigns from opportunities.

**Data:** `getDuckCampaigns` + `getDuckCampaignDays` + `getMonthPlan({ month, year })`

**Layout:** Full-viewport, breaks out of AppShell padding (`-mx-6 -my-7`, `height: calc(100vh - 64px)`).
- Header bar: title + "New Campaign" button
- Main: react-big-calendar (month view, `toolbar=false`, `selectable=true`) + right panel (width 288px)
- Calendar events: opportunities (festival/holiday/regional/dealership color-coded) + campaigns (expanded per-day, colored by objective)
- Right panel default: Opportunities list for current month + Campaigns list
- Right panel on opp select: opportunity detail card + "Plan this Campaign" button
- Month navigation: prev/next buttons (← →) + month/year label

**Interactions:**
- Click date slot → open `CampaignPlannerWizard` with that date pre-filled; if date has an opportunity, pre-fill name/theme
- Click opportunity event → show opportunity detail in right panel
- Click campaign event → open `CampaignDetailDialog`
- Month nav → fetch new `getMonthPlan` async (loading state on calendar)

**Components:**
- `CampaignPlannerWizard` — multi-step dialog: name/dates/objective/vehicle/budget/channel/notes → `createCampaign`
- `CampaignDetailDialog` — campaign summary + delete → `deleteCampaign`
- CSS overrides: `rbc-overrides.css` for brand colors in react-big-calendar

---

### 6.3 Content Studio (`/marketing/content-studio`)
**Purpose:** Generate AI content (caption + headline + poster) for a campaign post, then submit for approval.

**Data:** `getCampaigns` + `getDuckCampaignDays`

**Layout:** 3-panel, full-height:
- **Left panel (256px):** Campaign selector → Campaign Days list (per-day theme/vehicle) → Vehicle selector → Auto-loaded Assets display → Channel buttons (Instagram/Facebook/Google Business/WhatsApp) → Special Offer input → "Generate Content" primary action
- **Center panel (flex-1):** Toolbar (campaign + day context + Download Poster + Submit for Approval) → content output area (headline/subheadline, caption/char count, hashtags, CTA button, poster preview)
- **Right panel (256px):** Channel preview mockup (scaled social post preview)

**Flows:**
1. Select campaign → days load in left panel → select day → auto-fills vehicle + theme
2. Configure channel + vehicle + optional offer → "Generate Content" → calls `generateContent` → shows caption/headline/hashtags/CTA
3. "Generate AI Poster" → calls `generatePoster` → shows real image (NVIDIA) or CSS template fallback
4. "Download Poster" → Canvas API: draws gradient bg or real image + brand overlay → downloads PNG (1080×1080)
5. "Submit for Approval" → calls `submitForApproval` → navigates to `/marketing/compliance-center`

**Poster download:** Canvas 1080×1080, uses real `posterImageUrl` as background when available (crossOrigin anonymous), overlays NISSAN badge + vehicle tag + theme + headline + subheadline + CTA button.

---

### 6.4 Compliance Center (`/marketing/compliance-center`)
**Purpose:** Run Nissan brand compliance checks on posts before they go to human approval.

**Data:** `getCampaigns` → on campaign select: `getCampaignPosts({ campaign_id })`

**8 Nissan brand rules checked:**
1. Nissan Logo Placement
2. Brand Colors (Red / Black / Silver)
3. Contact Information
4. Offer / Disclaimer Accuracy
5. Grammar & Spelling
6. Professional Tone
7. Approved Asset Verification
8. Hashtag Brand Compliance

**Layout:**
- Campaign selector → posts list with compliance badges
- Post detail: compliance ring (SVG arc, color: green ≥80, amber ≥60, red <60) + rule checklist + "Run Compliance" button → `runCompliance` + "Submit for Approval" button → `submitForApproval`

---

### 6.5 Approval Queue (`/marketing/approval-queue`)
**Purpose:** Human review of content before publishing. Approve, reject, or request changes.

**Data:** `getApprovalQueue` (all posts; filtered client-side by tab)

**Layout:**
- Tab bar: Pending / Approved / Rejected (with counts)
- Post viewer: left/right navigation (ChevronLeft/Right) through filtered posts
- Post detail: channel badge, vehicle, caption, hashtags, poster preview, compliance badge
- Actions (Pending tab only): Approve (green) / Request Changes (amber, opens feedback dialog) / Reject (red, opens reason dialog)

**Status transitions:**
- Approve → `approvePost` → post moves to Approved tab
- Request Changes → `requestChangesPost({ feedback })` → post returns to draft
- Reject → `rejectPost({ reason })` → post moves to Rejected tab

---

### 6.6 Media Library (`/marketing/media-library`)
**Purpose:** Browse, filter, and upload brand-approved creative assets (vehicle images, logos, backgrounds).

**Data:** `getMediaAssets`

**Layout:**
- Sidebar: folder tree (All Assets / Vehicles/Magnite / Vehicles/Patrol / etc.)
- Toolbar: search + grid/list toggle + Upload button
- Asset grid: image preview, filename, type badge (image/video/document)

**Upload:** input[type=file] ref → `uploadMediaAsset`

---

### 6.7 Connected Channels (`/marketing/connected-channels`)
**Purpose:** View and manage social channel integrations.

**Data:** `getChannelStatus`

**Channels:** Instagram, Facebook, Google Business, WhatsApp Business

**Layout:** 4 channel cards showing connection status (connected/disconnected), account name, last sync. Connect/Disconnect/Refresh actions. Phase 1: status display only, no real OAuth (all channels show as stub/mocked).

---

### 6.8 Publishing (`/marketing/publishing`)
**Purpose:** Schedule and publish approved posts. Publishing Agent (mocked in V1 — status flip only, no real channel push).

**Data:** `getContentCalendar` (approved + scheduled posts)

**Layout:** Scheduled posts list/calendar with channel tags, scheduled time, status badges. "Publish Now" → `publishPost`.

---

## 7. Design System

Reuse `#/components/ui/kit` (Panel, Badge, Button, initials, timeAgo).
Marketing-specific components in `#/components/marketing/`:

| Component | Export | Purpose |
|---|---|---|
| `marketing-ui.tsx` | `ChannelTag` | colored chip per channel |
| | `PostStatusBadge` | draft/pending_approval/approved/scheduled/published/rejected |
| | `ComplianceBadge` | unchecked/approved/flagged |
| | `ObjectiveBadge` | awareness/lead_gen/offer/festival/launch |
| | `CampaignStatusBadge` | draft/scheduled/active/completed/archived |
| | `OPPORTUNITY_META` | kind → label + color + icon |
| | `AgentTag` | credits the generating agent by name |
| `CampaignPlannerWizard.tsx` | `CampaignPlannerWizard` | multi-step campaign creation |
| `CampaignDetailDialog.tsx` | `CampaignDetailDialog` | campaign summary + delete |
| `rbc-overrides.css` | — | react-big-calendar brand colors |

**Design tokens:**
- Brand red: `#C3002F` / hover `#a50027`
- Brand text utility: `brand-text`, bg: `brand-bg`
- Font: Hanken Grotesk + Fraunces (display)
- Tailwind v4 only — no `font-700`, no fractional sizes like `h-5.5`
- Numbers get class `num`
- Import alias: `#/` → `src/`

---

## 8. Key Technical Rules

1. **Never name server-fn files `*.server.ts`** — TanStack mocks them. Marketing server functions live in `marketing.ts`.
2. **Never return `unknown` or raw `jsonb`** from a server function — use `JsonValue` from `#/lib/types`.
3. **After mutations, call `await router.invalidate()`** — never `router.navigate()` to same page (aborts in-flight RPC).
4. **DuckDB for analytics** — campaign and campaign_days data writes to DuckDB (`analytics.duckdb.ts`) in addition to Supabase. `getDuckCampaigns` / `getDuckCampaignDays` read from DuckDB.
5. **AI seam** — `hasAnthropicKey()` in `anthropic.server.ts` gates real vs. template generation. Same return shape either way so UI is agnostic.
6. **Tenant isolation** — RLS on `campaigns`, `campaign_posts`, `campaign_insights`, `market_signals`. No app-layer filtering trusted for security.
7. **CALENDAR constant** — `lib/marketing.ts` has a deterministic in-memory dataset for India/Tamil Nadu occasions (months 1–12). This is NOT a DB table. Extend in-file; do not migrate.

---

## 9. Data Flow Summary

```
User → Campaign Planner → createCampaign
                                │
                                ▼
             Content Studio → generateContent (Agent 3 — Claude)
                                │
                                ▼
                          generatePoster (Agent 4 — NVIDIA)
                                │
                                ▼
          Compliance Center → runCompliance (Agent 5 — rule-based)
                                │
                                ▼
                         submitForApproval
                                │
                                ▼
           Approval Queue → approvePost / rejectPost / requestChangesPost
                                │
                                ▼
                Publishing → publishPost (Agent 6 — mocked)
                                │
                                ▼
          Dashboard + Intelligence ← campaign_insights (Agent 7 — seeded)
```

---

## 10. Acceptance Criteria

- [ ] Dashboard KPIs reflect live DB counts (RLS-scoped)
- [ ] Campaign Planner shows festivals/holidays from Calendarific (or CALENDAR fallback)
- [ ] Creating a campaign writes to Supabase + DuckDB; appears on calendar
- [ ] Content Studio generates caption + headline + hashtags + CTA; poster prompt always set; real image when NVIDIA key present
- [ ] Canvas poster download produces 1080×1080 PNG with brand overlay
- [ ] Compliance check runs 8 rules and sets compliance score
- [ ] Approval flow: pending → approved / rejected / draft transitions persist
- [ ] Publishing sets `published_at` + `published` status
- [ ] XYZ tenant cannot see ABC tenant campaigns (cross-tenant isolation)
- [ ] All pages verified in a real browser (not just type-check / unit test)
