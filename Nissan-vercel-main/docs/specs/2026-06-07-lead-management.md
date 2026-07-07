# ADIP — Lead Management Module Spec (V1)

**Status:** Building (Phase 2 module). Sits on the frozen spine (Tier 1) + web shell (Tier 3).
**Hand-off:** This module is one of three handed to teams for iteration after V1.

## Purpose
Single source of truth for dealership leads across all sources, with AI-style scoring,
assignment, follow-ups, and a visual sales pipeline. Every lead connects to the canonical
`customers` record (Customer 360).

## Domain model (module-owned; FK to spine)

### `leads`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid → tenants | RLS boundary |
| location_id | uuid → locations | showroom |
| customer_id | uuid → customers (null) | the canonical person (Customer 360 anchor) |
| source | enum | oem, website, facebook, instagram, walkin, phone, event, referral |
| stage | enum | new, contacted, qualified, test_drive, quotation, negotiation, won, lost |
| score | enum | hot, warm, cold |
| score_value | int | 0–100 (drives the score band) |
| assigned_to | uuid → users (null) | sales executive |
| vehicle_interest | text | e.g. "Magnite" |
| budget | numeric | ₹ |
| notes | text | |
| created_at / updated_at / last_activity_at | timestamptz | |

### `lead_events` — unified activity timeline (test drives & quotations are event types)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid → tenants | |
| lead_id | uuid → leads | |
| type | enum | note, call, email, whatsapp, stage_change, assignment, test_drive, quotation |
| summary | text | |
| metadata | jsonb | structured (e.g. {scheduled_at}, {amount}, {from_stage,to_stage}) |
| created_by | uuid → users (null) | actor |
| created_at | timestamptz | |

RLS: `tenant_id = public.tenant_id()` on both tables (same pattern as the spine).

## Scoring (rule-based for V1; AI in a later phase)
`score_value` → band: ≥70 hot, 40–69 warm, <40 cold. Seeded values reflect engagement.

## Server functions (the frozen contract for the UI)
- `getLeads()` → all leads for the tenant (RLS) with customer name + assignee name joined.
- `getLeadBoard()` → leads grouped by stage + per-stage count and pipeline value + headline stats.
- `getLead(id)` → one lead + its `lead_events` timeline + customer + assignee.
- `getSalesTeam()` → assignable users (dealer roles) for reassignment.
- `updateLeadStage({id, stage})` → moves a lead; writes a `stage_change` event; updates last_activity_at.
- `assignLead({id, assigned_to})` → reassign; writes an `assignment` event.
- `addLeadEvent({lead_id, type, summary, metadata})` → note/call/test_drive/quotation; updates last_activity_at.

All mutations go through server functions using the caller's JWT (RLS-enforced). Files must NOT
be named `*.server.ts` (TanStack mocks those on the client) — server fns live in `src/lib/leads.ts`.

## UI
- **`/leads`** — Pipeline board: stage columns with lead cards (customer, vehicle, score badge,
  source, assignee avatar, ₹ value), column totals, a stats bar (total · hot · pipeline value ·
  win rate), and filters (score, source, assignee, search). Each card links to detail; a quick
  stage menu moves a lead.
- **`/leads/$leadId`** — Detail: header (customer + score + stage + assignee), Customer 360 link,
  key facts, activity timeline, composer to add note/call/test-drive/quotation, change stage,
  reassign, and a rule-based **Next Best Action** panel.

## Design
Reuse the Tier 3 design system: `#/components/ui/kit` (Panel, Badge, Button, initials, timeAgo),
brand var (`var(--brand)`), Hanken Grotesk / Fraunces, lucide icons, `#/` import alias.
Score tones: hot=rose/brand, warm=amber, cold=sky/zinc.

## Acceptance
Pipeline renders RLS-scoped leads grouped by stage with correct totals; opening a lead shows its
timeline; changing stage / adding a note / reassigning persists and writes a timeline event;
isolation holds (XYZ sees only XYZ leads). Verified in a real browser.
