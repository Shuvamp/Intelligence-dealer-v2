---
name: frontend
description: Build and review frontend code in apps/web (TanStack Start + React). Use when adding/editing pages, routes, or components, or when reviewing frontend/TSX changes. Enforces project conventions — thin BFF (no business logic), design-system reuse (ui/kit + radix), TanStack file routing, server functions that proxy to FastAPI, and accessibility.
---

# Frontend (apps/web) — Build & Review

`apps/web` is TanStack Start (React) acting as frontend **and** BFF. It contains
**no business logic** — that lives in FastAPI (`apps/api`, port 8000). This skill
covers building new UI and reviewing frontend changes against project conventions.

## Golden rules (violations are review blockers)

1. **No business logic in web.** Scoring, assignment, agent orchestration, data
   mutation rules — all in `apps/api`. Web server functions only fetch/proxy and shape
   data for the view.
2. **Reuse the design system.** Do not hand-roll buttons, badges, panels, or dialogs
   with raw `<div>`/`<button>` + Tailwind when a primitive exists. See "Primitives".
3. **Import alias is `#/`** → `apps/web/src`. Never use long relative `../../..` paths.
   e.g. `import { cn } from '#/lib/utils'`.
4. **Class merging via `cn()`** (`#/lib/utils`) — clsx + tailwind-merge. Never
   template-string concatenate class names.
5. **Style with semantic tokens, not raw colors.** Use `border-border`, `bg-card`,
   `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`,
   `bg-primary`, `var(--brand)`. Avoid hardcoded `#hex`/`gray-500` except brand-channel
   colors already keyed in a `*_META` map.
6. **Icons = `lucide-react`.** Import named icons; size with `h-4 w-4` etc.

## File layout

- Routes: `apps/web/src/routes/_authed/<name>.tsx` (authed) — file-based routing.
  Nested/dotted names map to nested paths (`marketing.publishing.tsx` → `/marketing/publishing`).
- Components: `apps/web/src/components/<feature>/<Name>.tsx` (PascalCase files for
  components; kebab/`*-ui.tsx` for grab-bag modules following existing feature).
- Shared server fns + types: `apps/web/src/lib/<feature>.ts`, types in `#/lib/types`.
- Primitives: `apps/web/src/components/ui/` (`kit.tsx`, `dialog.tsx`, `button.tsx`).

## Routes — the pattern

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { getPublishing } from '#/lib/marketing'

export const Route = createFileRoute('/_authed/marketing/publishing')({
  loader: async () => {
    const [items, channels] = await Promise.all([getPublishing(), getChannelStatus()])
    return { items, channels }
  },
  component: Publishing,
})

function Publishing() {
  const { items } = Route.useLoaderData()
  // ...
}
```

- Fetch in `loader`, batch with `Promise.all`, read via `Route.useLoaderData()`.
- Navigation: `Link` from `@tanstack/react-router`; refresh loader via `useRouter().invalidate()`.

## Server functions (BFF) — the pattern

`createServerFn` runs server-side; use it to talk to FastAPI without browser CORS.
Keep it thin — validate input, call the API, return JSON. No logic.

```ts
import { createServerFn } from '@tanstack/react-start'

export const runFollowup = createServerFn({ method: 'POST' })
  .validator((d: { lead_id: string }) => d)
  .handler(async ({ data }): Promise<FollowupResult> => {
    const apiUrl = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'
    const res = await fetch(`${apiUrl}/followup/${data.lead_id}`, { method: 'POST' })
    if (!res.ok) throw new Error(`Follow-up agent failed: ${res.status}`)
    return res.json() as Promise<FollowupResult>
  })
```

## Primitives — use before building

From `#/components/ui/kit`:
- `Panel` — card container (`rounded-xl border border-border bg-card shadow-card`).
- `PanelHeader` — `title` / `kicker` / `action` header row.
- `Drawer` — slide-over ({ open, onClose, title, children }; Esc + backdrop close).
- `Badge` — `tone`: `neutral | brand | emerald | amber | sky | rose`.
- `Button` — `variant`: `primary | brand | ghost | outline`. (Also re-exported from `ui/button`.)
- Helpers: `initials()`, `timeAgo()`, `formatIN()` / `formatINTime()` (Asia/Kolkata, 12h).
  Use `formatIN` for absolute timestamps — don't reinvent date formatting.

From `#/components/ui/dialog` (radix-based): `Dialog`, `DialogTrigger`, `DialogContent`,
`DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`.
Use this for modals — do NOT build a modal from scratch.

## Accessibility (build + review)

- Interactive elements are `<button type="button">` (or Link) — never clickable bare `<div>`.
- Icon-only controls need `aria-label`. Modals/overlays need `role="dialog"` + `aria-modal`.
- Support Esc-to-close and backdrop-close on overlays (see `Drawer`).

## Review checklist

When reviewing a frontend diff, flag:
- ⛔ Business logic in web (should be in `apps/api`).
- ⛔ Raw markup duplicating an existing primitive (button/badge/panel/dialog).
- ⛔ `../../..` relative imports instead of `#/`.
- ⛔ Hardcoded colors/spacing instead of semantic tokens; class strings not through `cn()`.
- ⛔ Fetch/side-effects in render instead of `loader` / server fn.
- ⛔ a11y gaps: unlabeled icon buttons, div-as-button, missing dialog roles.
- ⚠️ Data fetched sequentially that could be `Promise.all`.
- ⚠️ New dependency added for something a primitive already covers.

Report findings one line each: `path:line: <severity>: <problem>. <fix>.`
Skip pure formatting nits unless they change meaning.
