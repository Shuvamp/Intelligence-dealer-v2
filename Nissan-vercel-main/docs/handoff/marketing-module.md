# Marketing Module — Team Hand-off Guide

You're building the **UI** for the Marketing Intelligence module. The foundation
(schema, RLS, seed, types, server functions, UI kit) is done and verified. You build pages.

## Read first
- Spec & vision: `docs/specs/2026-06-07-marketing-automation.md` (the 8-agent architecture)
- Mirror these working pages for patterns: `apps/web/src/routes/_authed/leads.index.tsx` (board + loader + filters) and `leads.$leadId.tsx` (detail + mutations + `router.invalidate()`)

## Run it
```bash
cd apps/web && npm run dev              # http://localhost:3000, against the hosted Supabase project
```
Sign in with a real account. Create a campaign/post via the UI to exercise the flow; a
second tenant's account is useful for verifying isolation.

## What's already built (your contract — don't rebuild)
- **Types:** `apps/web/src/lib/types.ts` — Campaign, CampaignPost, CampaignInsight, MarketingOverview, MonthPlan, MonthOpportunity, RecommendedCampaign, CampaignSummary, CampaignScorecard.
- **Server functions:** `apps/web/src/lib/marketing.ts` (the agent workflow):
  - Reads: `getMarketingOverview`, `getMonthPlan({month})` *(real festival calendar)*, `getRecommendedCampaigns`, `getCampaigns`, `getCampaign({id})`, `getContentCalendar`, `getApprovalQueue`, `getCampaignScorecard({id})`, `marketingCopilot({question})`.
  - Mutations: `createCampaign`, `generateContent({channel,vehicle,offer?,objective?,theme?})`, `generatePoster({post_id})`, `runCompliance({post_id})`, `submitForApproval`, `approvePost`, `rejectPost`, `schedulePost({id,scheduled_at})`, `publishPost`.
  - Call from client components as `await fn({ data: { ... } })`; after a mutation call `await router.invalidate()`.
- **UI kit:** `apps/web/src/components/marketing/marketing-ui.tsx` — ChannelTag, PostStatusBadge, ComplianceBadge, ObjectiveBadge, CampaignStatusBadge, OPPORTUNITY_META, AgentTag. Plus the shared `#/components/ui/kit` (Panel, Badge, Button, initials, timeAgo).

## Pages to build (suggested order)
1. **Marketing command center** — route `routes/_authed/marketing.index.tsx` (replace the current `marketing.tsx` placeholder). Compose: `getMarketingOverview` stat bar · `getRecommendedCampaigns` (Strategy Agent cards, use `AgentTag`) · content pipeline + published · a Marketing Copilot ask-box (`marketingCopilot`). Make it feel like a command center.
2. **Month Planner** — pick a month → `getMonthPlan`; render opportunities with `OPPORTUNITY_META`; "Create campaign from this" → `createCampaign`.
3. **Content / Poster Generator** — form → `generateContent` then `generatePoster`; preview caption + hashtags + poster placeholder (poster_url is null in V1 — render a branded placeholder using `poster_prompt`); `runCompliance`; `submitForApproval`.
4. **Campaign Calendar** — `getContentCalendar`; chips colored by channel (`ChannelTag`) / status (`PostStatusBadge`).
5. **Approval Queue** — `getApprovalQueue`; approve/reject/schedule/publish; show `ComplianceBadge`.
6. **Campaign detail + Scorecard** — `getCampaign` / `getCampaignScorecard` (reach, engagement, leads, CPL, conversion).

## The agent seam (how to make agents "real" later)
Each generation agent is a server function with an `// AGENT STUB → swap for Claude` block:
- `generateContent` returns templated caption/hashtags/CTA → replace body with a Claude call.
- `generatePoster` sets a `poster_prompt` → send it to an image model, store the URL.
Signatures/return shapes stay the same, so the UI never changes. The 8 agents are registered in
`agent_registry` (`module='marketing'`) — surface them in the UI with `AgentTag` to credit the work.

## Hard rules (the app's gotchas — don't relearn them)
- **Never** name a server-fn file `*.server.ts` — TanStack mocks it on the client and the RPC breaks. Server fns live in `marketing.ts`.
- jsonb/`unknown` in a server-fn **return** breaks its type — use the `JsonValue` type.
- After a mutation: `await router.invalidate()`. Never `router.navigate` to the same page (it aborts the in-flight RPC).
- `#/` → `src/`. Tailwind v4 (only valid classes — no `font-700`, no `h-5.5`). Brand accent: `var(--brand)` / `brand-bg` / `brand-text`. Numbers: class `num`.
- Verify in a real browser before calling it done (Playwright scripts in `apps/web/scripts/verify-*.mjs` show the pattern). Confirm tenant isolation with a second account.
