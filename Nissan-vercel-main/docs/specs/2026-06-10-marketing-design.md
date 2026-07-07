# ADIP — Marketing Module Design Doc

**Date:** 2026-06-10
**Scope:** Visual design, layout, component patterns, and interaction spec for all marketing pages.
**Companion:** `2026-06-10-marketing-module.md` (system spec)

---

## 1. Design Philosophy

**Command center, not a scheduler.** Every screen should feel like a dashboard a Nissan dealer manager opens every morning — information-dense but scannable, with clear next-actions. Inspired by Salesforce (density), Linear (interaction speed), and Notion (composability).

Three principles:
1. **Hierarchy first.** Primary action always visible without scroll. KPIs before lists. Alerts before routine data.
2. **Brand-present but not loud.** Nissan red (#C3002F) reserved for primary CTAs and active states. Background is near-white; red used sparingly so it still carries weight.
3. **Data wins.** Real numbers, live statuses. No decorative charts. If a number can be shown, show it.

---

## 2. Design Tokens

### Colors
| Token | Value | Use |
|---|---|---|
| `--brand` | `#C3002F` | Primary CTAs, active states, brand badges — set per tenant |
| `--brand` hover | `#a50027` | Button hover only |
| `--background` | `oklch(0.991 0.002 95)` | Near-white canvas |
| `--foreground` | `oklch(0.23 0.02 264)` | Body text (deep ink) |
| `--card` | `oklch(1 0 0)` | Panel backgrounds (pure white) |
| `--muted` | `oklch(0.967 0.003 250)` | Input backgrounds, pill fills |
| `--muted-foreground` | `oklch(0.52 0.018 260)` | Secondary text, labels |
| `--border` | `oklch(0.916 0.004 260)` | All dividers and panel borders |
| `--sidebar` | `oklch(0.218 0.032 266)` | Dark sidebar background |
| `--sidebar-foreground` | `oklch(0.78 0.018 266)` | Sidebar text |

**Marketing-specific semantic colors (hardcoded, not tokens):**
| Use | Hex |
|---|---|
| Campaign active / success | `#22C55E` |
| Campaign draft / neutral | `#6B7280` |
| Pending approval / warning | `#F59E0B` |
| Rejected / destructive | `#EF4444` |
| Instagram | `#E1306C` |
| Facebook | `#1877F2` |
| Google Business | `#34A853` |
| WhatsApp | `#25D366` |
| Festival opportunity | `#C3002F` |
| Holiday opportunity | `#1877F2` |
| Regional opportunity | `#34A853` |
| Dealership opportunity | `#F59E0B` |

**Campaign objective colors:**
| Objective | Hex |
|---|---|
| awareness | `#1877F2` |
| lead_gen | `#16A34A` |
| offer | `#D97706` |
| festival | `#C3002F` |
| launch | `#7C3AED` |

### Typography
| Family | Variable | Use |
|---|---|---|
| Hanken Grotesk | `--font-sans` | All UI text (default body) |
| Fraunces | `--font-display` | Hero headings, display numbers |
| Geist Mono | `--font-mono` | Code, poster prompts, metrics |

**Type scale in use (px sizes, not rem, for pixel-precision):**
| Size | Weight | Use |
|---|---|---|
| 28px bold | 700 | Page H1 (dashboard title) |
| 24px bold | 700 | Section H1 (campaign planner title) |
| 15–16px semibold | 600 | Panel headings |
| 14px semibold | 600 | Sub-section labels, card headings |
| 13px medium | 500 | Body text, form inputs |
| 12px semibold | 600 | Metadata, secondary labels |
| 11px semibold | 600 | Badge text, kicker labels |
| 10px bold | 700 | Kicker caps, event text in calendar |
| 9px semibold | 600 | Micro-labels, asset references |

**Special classes:**
- `.num` — tabular-nums + tracking-tight (-0.02em). Always use for metrics/counts.
- `.kicker` — uppercase + tracking-wide (0.13em) + 700 + 0.66rem. Section labels.
- `.font-display` — Fraunces + tracking-tight (-0.01em). Headlines only.

### Spacing & Radius
- Base radius: `--radius: 0.8rem` (12.8px)
- Panel/card radius: `rounded-[16px]` to `rounded-[18px]`
- Button radius: `rounded-[10px]` to `rounded-[12px]`
- Badge/chip radius: `rounded-full`
- Input radius: `rounded-[10px]`
- Calendar wrapper: `rounded-[18px]`
- Dialog/sheet: `rounded-[16px]`

### Shadows
| Class | Use |
|---|---|
| `.shadow-card` | All panels/cards on light canvas |
| `.shadow-float` | Dialogs, dropdowns, popovers |

### Canvas
`.app-canvas` — radial brand gradient at top-right (8% brand opacity), subtle navy at top-left. Applied at root layout, not per-page.

---

## 3. Shell Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar (252px, dark bg --sidebar)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Logo lockup (brand icon + "Dealer Intelligence OS")│    │
│  │  ─────────────────────────────────────────────────  │    │
│  │  Workspace nav group                                │    │
│  │    Dashboard · Leads · Marketing ← active           │    │
│  │    Intelligence · Copilot · Customers               │    │
│  │  System nav group                                   │    │
│  │    Reports · Settings · Subscription                │    │
│  │  ─────────────────────────────────────────────────  │    │
│  │  [intelligence] plan chip                           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Main area (flex-1, overflow-y-auto)                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  TopBar (h-16, border-b) — breadcrumb + user menu   │    │
│  │  ─────────────────────────────────────────────────  │    │
│  │  Page content (px-6 py-7 by default)                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Marketing sub-nav** (within the Marketing section): no secondary nav bar. Navigation between marketing pages happens via direct links from the Dashboard AI Pipeline widget, the sidebar, and in-page CTAs.

---

## 4. Page Layouts

### 4.1 Marketing Dashboard

**Layout type:** Scrollable content page. `max-w-[1400px] mx-auto p-6 space-y-6`.

```
┌──────────────────────────────────────────────────┐
│  [NISSAN] Marketing Intelligence Platform         │
│  Marketing Dashboard                    [New Cmp] │
├──────────────────────────────────────────────────┤
│  KPI row — 6 equal-width cards                   │
│  Active  Pending  Published  Pipeline  Leads  CPL │
├──────────────────────────────────────────────────┤
│  AI Agent Pipeline                               │
│  ○─────○─────○─────○─────○─────○                 │
│  Plan  Create  Comply  Approve  Pub  Analytics   │
├──────────────────────────────────────────────────┤
│  Active Campaigns (3/5)  │  Approval Queue (2/5) │
│  list of campaigns       │  top 3 pending items  │
│                          │  [Review All] button  │
└──────────────────────────────────────────────────┘
```

**KPI Card anatomy:**
```
┌──────────────────────────────┐
│  ACTIVE CAMPAIGNS  [icon bg] │
│  18                    [icon]│
│  optional sub-text           │
│  optional action link →      │
└──────────────────────────────┘
```
- Card: `rounded-[16px] border bg-white p-4`
- Warning variant: `border-amber-200`
- Icon container: `h-9 w-9 rounded-lg` with colored bg
- Value: `text-[26px] font-bold leading-none` + `.num`

**AI Agent Pipeline:**
- 6 circles connected by `h-0.5 bg-border` lines
- Each circle: `w-9 h-9 rounded-full border-2` with matching status color
- Dot inside: `w-2.5 h-2.5 rounded-full`
- Labels: `text-[10px]` below, status count in matching color
- Entire unit is scrollable (`overflow-x-auto`) on small screens

---

### 4.2 Campaign Planner

**Layout type:** Full-viewport. Breaks out of AppShell padding:
```tsx
<div className="-mx-6 -my-7 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
```

```
┌─────────────────────────────────────────────────────────┐
│  Header bar (border-b px-6 py-4)                        │
│  Campaign Planner + subtitle          [New Campaign btn] │
├──────────────────────────────────────┬──────────────────┤
│  Calendar area (flex-1, p-6)         │  Right panel     │
│                                      │  (w-72, border-l)│
│  Toolbar: ← [Month Year] →  Legend   │                  │
│                                      │  Default state:  │
│  react-big-calendar                  │  Opportunities   │
│  .rbc-brand wrapper                  │  list for month  │
│  rounded-[18px] border-2             │  ─────────────   │
│  relative + absolute inset-0         │  Campaigns list  │
│  (gives Calendar definite px height) │                  │
│                                      │  Opp selected:   │
│                                      │  Kind badge      │
│                                      │  Name + theme    │
│                                      │  Suggestion text │
│                                      │  [Plan Campaign] │
└──────────────────────────────────────┴──────────────────┘
```

**Calendar event chips:**
- Opportunity: solid color pill, `fontSize: 9px`, truncated name
- Campaign (per-day): 2-line chip — `fontSize: 9px` bold name, `fontSize: 8px` opacity-80 theme + vehicle
- Event selected state: `box-shadow: 0 0 0 2px rgba(195,0,47,0.35)`

**Legend row:** colored dots + capitalize kind labels, `text-[11px]`.

**Right panel items:** `rounded-[10px] border border-border p-3 hover:border-[#C3002F] hover:bg-[#FFF8F8] transition`

---

### 4.3 Content Studio

**Layout type:** Full-height 3-panel. No AppShell scroll — panels own their own scroll.

```
┌─────────────────┬───────────────────────────────┬──────────────┐
│  Left (w-64)    │  Center (flex-1)               │  Right (w-64)│
│  bg-white       │  border-r border-border        │  bg-white    │
│  border-r       │                                │              │
│  ─────────────  │  Toolbar (px-5 py-3 border-b): │  Channel     │
│  Campaign sel   │  vehicle—campaign  [Dl] [Sub]  │  Preview     │
│  ─────────────  │  ───────────────────────────── │  4 channel   │
│  Campaign Days  │  Content area (flex-1 p-5):    │  tab buttons │
│  (if campaign   │                                │  ─────────── │
│  has day plan)  │  Empty state: Zap icon +       │  Scaled      │
│  ─────────────  │  "Select campaign..." hint     │  social post │
│  Vehicle sel    │                                │  mockup      │
│  ─────────────  │  Generated state:              │  (w-[200px]) │
│  Assets panel   │  Headline / Subheadline grid   │              │
│  (red-tinted)   │  Caption textarea (char count) │              │
│  ─────────────  │  Hashtag pills                 │              │
│  Channel btns   │  CTA button preview            │              │
│  ─────────────  │  Poster Preview / AI Image     │              │
│  Offer input    │  Prompt text (muted)           │              │
│  ─────────────  │                                │              │
│  [Generate]     │                                │              │
└─────────────────┴───────────────────────────────┴──────────────┘
```

**Left panel sections** — each separated by `border-b border-border`:
- Campaign dropdown: `appearance-none` + `ChevronDown` icon overlay
- Campaign Days: `max-h-[200px] overflow-y-auto`, active day has `bg-[#FFF0F3] border-[#FECDD3]`, day badge `bg-[#C3002F] text-white` when active
- Assets panel: `rounded-[10px] bg-[#FFF8F8] border border-[#FECDD3]`, `text-[9px] font-bold text-[#C3002F] uppercase tracking-widest`
- Channel buttons: `border-transparent hover:bg-muted/40` → active: `border-[#C3002F] bg-[#FFF0F3] text-[#C3002F]`

**Generate button (sticky footer):** `border-t border-border p-3` — `w-full rounded-[10px] bg-[#C3002F]`.

**Poster section:**
- Real AI image: `aspect-ratio: 1/1`, `overflow-hidden`, gradient scrim overlay (`linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)`), brand elements positioned absolute
- Template fallback: dark gradient card (`linear-gradient(135deg, #1A1A1A 0%, #3D0A00 100%)`)
- "Generated" badge: `absolute top-2 right-2 bg-green-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-full`

**Hashtag pills:** `bg-[#FFF0F3] border border-[#FECDD3] text-[11px] text-[#C3002F]` + `Hash` icon

**Channel preview mockup (right panel):** max-width 200px, colored header bar for active channel, dark gradient image area, caption text at 7px.

---

### 4.4 Compliance Center

**Layout type:** Scrollable content page with campaign selector + post list.

```
┌─────────────────────────────────────────────────────┐
│  Page title: "Compliance Center"                    │
│  Campaign selector (dropdown)                       │
├──────────────────────────────────────────────────── ┤
│  Posts list                                         │
│  ┌───────────────────────────────────────────────┐  │
│  │  Post title + channel badge + compliance badge │  │
│  │  ────────────────────────────────────────────  │  │
│  │  Expanded: compliance ring + rule checklist   │  │
│  │            [Run Compliance] [Submit for Appr] │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Compliance Ring (SVG):**
- `r=42`, `circ = 2π × 42`
- Arc offset = `circ - (score/100) × circ`
- Color: `#22C55E` (≥80) · `#F59E0B` (≥60) · `#EF4444` (<60)
- Score label centered inside ring, large bold `.num`

**Rule checklist:** 8 rows — checkbox icon (green check / red X / gray unchecked) + rule name + pass/fail label.

---

### 4.5 Approval Queue

**Layout type:** Scrollable. Tab bar + centered post viewer with prev/next nav.

```
┌─────────────────────────────────────────────────────┐
│  Pending (N) │ Approved (N) │ Rejected (N)           │
├─────────────────────────────────────────────────────┤
│                                                     │
│   ←                                             →  │
│   ┌───────────────────────────────────────────┐    │
│   │  [Channel]  [Vehicle]                     │    │
│   │  Post title                               │    │
│   │  Compliance: ● approved                   │    │
│   │  Caption text                             │    │
│   │  #hashtag1  #hashtag2                     │    │
│   │  ─────────────────────────────────────    │    │
│   │  [Approve ✓]  [Request Changes]  [Reject] │    │
│   └───────────────────────────────────────────┘    │
│   Post 2 of 5                                      │
└─────────────────────────────────────────────────────┘
```

**Tab bar:** active tab `border-b-2 border-[#C3002F] text-foreground`, inactive `text-muted-foreground hover:text-foreground`.

**Action buttons:**
- Approve: `bg-green-600 hover:bg-green-700 text-white`
- Request Changes: `bg-amber-500 hover:bg-amber-600 text-white` → opens feedback textarea dialog
- Reject: `bg-red-600 hover:bg-red-700 text-white` → opens reason input dialog

**Reject / Request Changes dialogs:** inline confirmation pattern — no separate modal; shows inline below buttons as an expand.

---

### 4.6 Media Library

**Layout type:** Sidebar + main area (sidebar ~200px, fixed; main scrollable grid).

```
┌─────────────────────┬──────────────────────────────────┐
│  Folder tree        │  Toolbar: [Search] [Grid][List]  │
│  ─────────────────  │          [Upload]                │
│  📦 All Assets      │  ─────────────────────────────── │
│  🚗 Vehicles        │  Asset grid (or list)            │
│     └ Magnite       │  ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│     └ Patrol        │  │img │ │img │ │img │ │img │    │
│     └ X-Trail       │  └────┘ └────┘ └────┘ └────┘    │
│  🖼 Backgrounds     │  filename  type-badge            │
│  🏷 Logos           │                                  │
└─────────────────────┴──────────────────────────────────┘
```

**Asset grid cards:** `rounded-[12px] border border-border overflow-hidden` — aspect-square image preview, filename `text-[11px] font-semibold truncate`, type badge below.

**Upload area:** hidden file input wired to button, no drag-drop UI in V1.

---

### 4.7 Connected Channels

**Layout type:** Scrollable. 4 channel cards in a 2-column grid.

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  [IG] Instagram              │  │  [FB] Facebook               │
│  Connected — @abcnissan.ig   │  │  Not connected               │
│  Last sync: 2h ago           │  │                              │
│  [Disconnect]  [Refresh]     │  │  [Connect]                   │
└──────────────────────────────┘  └──────────────────────────────┘
```

**Channel card:** `rounded-[16px] border border-border bg-white p-5` — icon block with brand color bg + initials, status badge (green/red), action buttons.

---

### 4.8 Publishing

**Layout type:** Scrollable. Posts list with schedule/status columns.

Scheduled posts sorted by `scheduled_at`. Each row: channel tag + post title + vehicle + scheduled time + status badge + "Publish Now" button (approved posts only).

---

## 5. Component Catalog

### From `#/components/marketing/`

#### `CampaignPlannerWizard`
4-step dialog: Details → Vehicles → Goal → Notes.

**Step indicator:**
```
①─────②─────③─────④
Det  Vehicles  Goal  Notes
```
- Completed: `bg-[#C3002F] text-white` circle with ✓
- Current: `border-2 border-[#C3002F] text-[#C3002F]` circle with number
- Pending: `border-2 border-border text-muted-foreground`
- Connector: `h-px w-4` — `bg-[#C3002F]` if completed, `bg-border` otherwise

**Field style:** `rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]`

**Vehicle multi-select:** pill buttons, selected = `bg-[#C3002F] text-white border-[#C3002F]`, unselected = `border border-border`.

**AI-Generated Plan display:** `rounded-[12px] bg-[#FFF8F8] border border-[#FECDD3] p-4` — shows per-day plan table with theme + vehicle columns.

**Actions:** Back (`outline`) / Next (`brand-bg`) / Create Campaign (`brand-bg full-width`).

#### `CampaignDetailDialog`
Read-only campaign summary + delete confirmation.

- Campaign metadata: name, dates, objective badge, vehicle, channel tags
- Posts count grouped by status
- Delete: secondary button → inline confirmation → `deleteCampaign`

### From `#/components/marketing/marketing-ui.tsx` (to be created per spec)

| Component | Render |
|---|---|
| `ChannelTag` | `rounded-full px-2 py-0.5 text-[10px] font-semibold` with channel color bg/text |
| `PostStatusBadge` | Color-coded by status: draft=gray, pending_approval=amber, approved=green, scheduled=blue, published=emerald, rejected=red |
| `ComplianceBadge` | unchecked=gray, approved=green, flagged=red — with ShieldCheck/AlertCircle icon |
| `ObjectiveBadge` | awareness=blue, lead_gen=green, offer=amber, festival=brand, launch=purple |
| `CampaignStatusBadge` | draft=gray, scheduled=blue, active=green, completed=teal, archived=muted |
| `OPPORTUNITY_META` | `{ festival: { color: '#C3002F', label: 'Festival' }, holiday: ..., regional: ..., dealership: ... }` |
| `AgentTag` | `rounded-full px-2 py-0.5 text-[10px] bg-muted text-muted-foreground` with Zap icon — credits agent by name |

### From `#/components/ui/kit`

| Component | Use in marketing |
|---|---|
| `Panel` | `rounded-xl border border-border bg-card shadow-card` wrapper |
| `PanelHeader` | title + optional kicker + optional action slot |
| `Badge` | tone variants: neutral/brand/emerald/amber/sky/rose |
| `Button` | variant: primary/brand/ghost/outline — `h-10 rounded-lg px-4 text-sm` |
| `initials(name)` | Avatar fallback in assignee chips |
| `timeAgo(iso)` | Relative timestamps |

---

## 6. Interaction Patterns

### Loading states
- Page loaders: TanStack loader runs before render; no skeleton screens needed at page level
- In-page async (month nav, generate): spinner inline in button — `<Loader2 className="animate-spin" />`
- Calendar month change: `opacity-50 pointer-events-none` on calendar + loader in title
- Generate Content: button shows "Generating…" + spinning RefreshCw, panel stays visible
- Poster generation: button shows "Generating image…", existing content stays

### Empty states
- No campaigns: centered `Zap` icon + text + CTA link
- No posts: centered icon + context-appropriate message
- All caught up (approval queue): large checkmark emoji + "All caught up!"

### Transitions
- Hover on cards/buttons: `transition` (150ms default)
- Route-level: TanStack handles; no custom page transitions
- Dialog: Radix Dialog handles fade + scale
- Calendar month opacity fade: `transition-opacity` class

### Feedback
- Mutations: optimistic local state update (statusFilter map in approval queue, campaigns splice on delete)
- After mutations: `await router.invalidate()` re-runs loaders
- Error states: not yet implemented in V1; console.error only
- Success navigation: Content Studio → submit → `router.navigate({ to: '/marketing/compliance-center' })`

### Dialog patterns
- All dialogs use `#/components/ui/dialog` (Radix Dialog)
- Max-width: `max-w-[640px]` for wizard, `max-w-[480px]` for confirmation
- Scrollable body: `overflow-y-auto max-h-[70vh]` inside DialogContent
- Footer: sticky at bottom with border-t, Back+Next or Cancel+Confirm

---

## 7. Poster Design System

The marketing poster is a core output. Two render paths:

### Path A: CSS template (no AI image)
```
┌─────────────────────────────────────────────┐
│  bg: linear-gradient(135deg, #1A1A1A, #3D0A00)│
│                                             │
│  ┌──────────┐          ┌────────────────┐   │
│  │ NISSAN   │          │  VEHICLE NAME  │   │
│  │ (red bg) │          │  (glass btn)   │   │
│  └──────────┘          └────────────────┘   │
│                                             │
│  THEME IN CAPS (muted)                      │
│  Big headline text (22px black)             │
│  Subheadline (12px 75% white)               │
│  Caption preview (10px 50% white, 2 lines)  │
│                                             │
│  ┌────────────┐    vehicle.jpg (watermark)  │
│  │    CTA     │    Logo.png    (watermark)  │
│  │ (red bg)   │    bg.jpg      (watermark)  │
│  └────────────┘                             │
└─────────────────────────────────────────────┘
```
Component: `<PosterPreview>` — pure CSS/JSX, no canvas.

### Path B: AI image + brand overlay
- Full-bleed image `object-cover`
- Gradient scrim: `linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)`
- NISSAN badge top-left: `bg-[#C3002F] px-3 py-1.5 rounded-[5px]` + tracking-[4px]
- Vehicle badge top-right: `bg-white/15 border border-white/25 rounded-[6px]`
- Text area bottom: theme kicker → headline → subheadline → CTA button
- "AI Generated" badge: `absolute top-2 right-2 bg-green-500 text-[8px] rounded-full`

### Canvas export (1080×1080 PNG)
On "Download Poster":
1. Draw real image OR dark gradient
2. Gradient scrim over full canvas
3. NISSAN badge (roundRect fill + text)
4. Vehicle tag (roundRect fill + text)
5. Theme label (tracking 4px)
6. Headline with word-wrap at 960px
7. Subheadline (80 char limit)
8. CTA button (roundRect + text)
9. `canvas.toDataURL('image/png')` → download link click

---

## 8. Calendar Design

Library: `react-big-calendar` with `date-fns` localizer.

**Required setup:**
```tsx
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '#/components/marketing/rbc-overrides.css'  // brand overrides, always after
```

**Brand class:** wrap `<Calendar>` in `<div className="rbc-brand">` — all overrides are scoped to `.rbc-brand`.

**Key overrides in `rbc-overrides.css`:**
- Header row: `text-[11px]` caps + gray bg + `border-bottom: 2px solid`
- Today: `background-color: rgba(219, 234, 254, 0.45)`
- Hover: `background-color: #fff0f3` (brand blush)
- Events: `border: none`, `border-radius: 4px`, `font-size: 10px`, `color: white`
- Selected: `box-shadow: 0 0 0 2px rgba(195,0,47,0.35)`
- `+N more` link: `color: #c3002f`
- Popup: `border-radius: 12px`, `box-shadow: 0 4px 24px rgba(0,0,0,0.1)`

**Height pattern** (calendar needs explicit height — use relative+absolute inset):
```tsx
<div className="relative flex-1 min-h-0 rounded-[18px] border-2 border-border overflow-hidden">
  <div className="absolute inset-0">
    <Calendar ... style={{ height: '100%' }} />
  </div>
</div>
```

---

## 9. Navigation Within Marketing

No secondary nav bar. Inter-page links via:

| From | To | Via |
|---|---|---|
| Dashboard | Campaign Planner | "New Campaign" btn, "View calendar" link, pipeline stage link |
| Dashboard | Approval Queue | "Review now" link, "Review All Approvals" btn |
| Dashboard | Content Studio | Pipeline stage link |
| Content Studio | Compliance Center | "Submit for Approval" → `router.navigate` |
| Compliance Center | Approval Queue | "Submit for Approval" → `router.invalidate` (stays on page) |
| Campaign Planner | Content Studio | No direct link (user picks campaign in Studio) |

Sidebar always shows the Marketing section with children collapsed under it (sub-routes handled by TanStack route nesting, not a nav accordion).

---

## 10. Pitfalls

| Pitfall | Fix |
|---|---|
| Calendar collapses to 0 height | Must use relative+absolute inset pattern; `flex-1 min-h-0` alone is not enough |
| Campaign Planner loses padding | Uses `-mx-6 -my-7` to break out of AppShell — intentional; do not remove |
| `router.navigate` to same page aborts RPCs | Use `router.invalidate()` after mutations |
| `rbc-overrides.css` not applying | Import order: base CSS first, overrides second; `.rbc-brand` scope required |
| Tailwind v4 unknown classes fail silently | No `font-700`, no `h-5.5`, no `text-gray-700/80`-style shorthand — use valid v4 classes only |
| Brand color drift | Never hardcode `red-600` or similar — use `#C3002F` / `var(--brand)` / `brand-bg` |
| Numbers not aligned | Always add `.num` class to metrics/counts |
