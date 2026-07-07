import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, X } from 'lucide-react'
import { formatIN } from '#/components/ui/kit'
import { LeadTimeline } from '#/components/leads/LeadTimeline'
import type { LeadDetail, LeadEvent } from '#/lib/types'

// Count of timeline rows after collapsing the follow-up agent's repeated NBA
// events to the most recent (mirrors what LeadTimeline renders) — used for the
// little count chip on the toggle button.
function visibleCount(events: Array<LeadEvent>): number {
  let latestNbaAt = -Infinity
  for (const e of events) {
    if (e.type === 'nba') latestNbaAt = Math.max(latestNbaAt, new Date(e.created_at).getTime())
  }
  return events.filter((e) => e.type !== 'nba' || new Date(e.created_at).getTime() === latestNbaAt).length
}

/**
 * Collapsible right-side activity drawer. A compact toggle button lives on the
 * lead page; the timeline is hidden by default and slides in from the right when
 * opened. The drawer is intentionally NON-modal — there's no dimming backdrop,
 * so the rest of the app stays visible and interactive while it's open. It
 * closes on the X button, Escape, or a click anywhere outside it. The body is
 * the same LeadTimeline used elsewhere, so it matches the app's activity style.
 */
export function ActivityDrawer({ detail }: { detail: LeadDetail }) {
  const { lead, events } = detail
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Escape + click-outside to close. No overlay is rendered, so we detect
  // outside clicks via a document listener and ignore clicks on the drawer
  // itself or its toggle (so the toggle keeps working as a clean open/close).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // Auto-scroll to the newest activity (bottom) each time the drawer opens.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [open])

  const count = visibleCount(events)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] font-semibold text-foreground shadow-sm transition hover:bg-muted"
      >
        <Activity className="h-4 w-4 brand-text" />
        Activity timeline
        {count > 0 ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
            {count}
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            // Portaled to <body> so `position: fixed` resolves against the
            // viewport — the lead page's `fade-up` wrapper sets a `transform`,
            // which would otherwise make the drawer fixed relative to it (and
            // overflow the page) instead of filling the screen height.
            <div
              ref={panelRef}
              className="slide-in-right fixed right-0 top-0 z-[60] flex h-screen w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[440px]"
              role="dialog"
              aria-modal="false"
              aria-label="Lead activity timeline"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <div className="kicker text-muted-foreground/70">Lead activity</div>
                  <div className="text-[15px] font-semibold text-foreground">Your activity</div>
                  <div className="num mt-0.5 text-[11.5px] text-muted-foreground/70" title={formatIN(lead.last_activity_at)}>
                    Updated {formatIN(lead.last_activity_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Close activity timeline"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
                <LeadTimeline events={events} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
