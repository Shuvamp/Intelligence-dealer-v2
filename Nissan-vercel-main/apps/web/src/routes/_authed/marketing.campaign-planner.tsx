import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { getDuckCampaigns, getDuckCampaignDays, getMonthEvents } from '#/lib/marketing'
import { Zap, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { CampaignDay, CampaignPlanInput, CampaignPost, CampaignSummary, MonthPlan } from '#/lib/types'
import { CampaignPlannerWizard } from '#/components/marketing/CampaignPlannerWizard'
import { MarketingRouteError } from '#/components/marketing/RouteError'
import { CampaignDetailDialog } from '#/components/marketing/CampaignDetailDialog'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { cn } from '#/lib/utils'
import { toast } from 'sonner'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '#/components/marketing/rbc-overrides.css'

export const Route = createFileRoute('/_authed/marketing/campaign-planner')({
  loader: async () => {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()
    const [campaigns, campaignDays, monthPlan] = await Promise.all([
      getDuckCampaigns(),
      getDuckCampaignDays(),
      getMonthEvents({ data: { month: currentMonth, year: currentYear } }),
    ])
    return { campaigns, campaignDays, calendar: [] as CampaignPost[], monthPlan, currentMonth, currentYear }
  },
  component: CampaignPlanner,
  errorComponent: ({ reset }) => <MarketingRouteError title="Could not load the campaign planner" reset={reset} />,
})

// ── react-big-calendar setup ──────────────────────────────────────────────────

const locales = { 'en-US': enUS }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  resource: {
    type: 'opportunity' | 'campaign'
    color: string
    data: MonthPlan['opportunities'][0] | CampaignSummary
    // campaign-only per-day fields
    dayNum?: number
    totalDays?: number
    theme?: string | null
    vehicle?: string | null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Handles both 'YYYY-MM-DD' and full Calendarific datetime 'YYYY-MM-DDTHH:mm:ss+TZ'
function parseLocalDate(iso: string | Date) {
  if (iso instanceof Date) return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate())
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Calendar colour theme — two roles only, to avoid confusing the admin:
//   • Monthly events (festivals/holidays/occasions) → one violet colour
//   • Campaigns → the user's chosen campaign_color, else Nissan red
const EVENT_COLOR = '#7C3AED'            // single colour for ALL monthly events
const CAMPAIGN_DEFAULT_COLOR = '#C3002F' // Nissan red, used when no campaign_color set

// ── Component ─────────────────────────────────────────────────────────────────

function CampaignPlanner() {
  const { campaigns: loaderCampaigns, campaignDays: loaderDays, calendar, monthPlan: loaderMonthPlan, currentMonth, currentYear } = Route.useLoaderData()

  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)
  const [monthPlan, setMonthPlan] = useState<MonthPlan>(loaderMonthPlan)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>(loaderCampaigns)
  const [campaignDays, setCampaignDays] = useState<CampaignDay[]>(loaderDays)

  useEffect(() => { setCampaigns(loaderCampaigns) }, [loaderCampaigns])
  useEffect(() => { setCampaignDays(loaderDays) }, [loaderDays])
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [selectedOpp, setSelectedOpp] = useState<MonthPlan['opportunities'][0] | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardDefaults, setWizardDefaults] = useState<Partial<CampaignPlanInput>>({})
  const [detailCampaign, setDetailCampaign] = useState<CampaignSummary | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const router = useRouter()

  // ── Derived data ─────────────────────────────────────────────────────────────

  // Scheduled posts → day count for this month+year (used in right panel future expansion)
  const postsByDay: Record<number, number> = {}
  for (const post of calendar) {
    if (post.scheduled_at) {
      const d = new Date(post.scheduled_at)
      if (d.getFullYear() === year && d.getMonth() + 1 === month) {
        postsByDay[d.getDate()] = (postsByDay[d.getDate()] ?? 0) + 1
      }
    }
  }

  // Opportunities filtered to current month+year
  const currentOpportunities = monthPlan.opportunities.filter((opp) => {
    const [y, m] = opp.date.split('-')
    return parseInt(m) === month && parseInt(y) === year
  })

  // Build a fast per-day info lookup: `campaignId-YYYY-MM-DD` → { theme, vehicle }
  const dayInfoMap = useMemo(() => {
    const m: Record<string, { theme: string; vehicle?: string }> = {}
    for (const d of campaignDays) {
      if (d.campaign_id) m[`${d.campaign_id}-${d.date}`] = { theme: d.theme, vehicle: d.vehicle ?? undefined }
    }
    return m
  }, [campaignDays])

  // Build CalEvent array — memoised so Calendar only re-renders when data changes.
  // Campaigns are expanded into one event per day; each cell shows name + daily theme.
  const events = useMemo<CalEvent[]>(() => [
    ...currentOpportunities.map((opp) => ({
      id: `opp-${opp.date}-${opp.name}`,
      title: opp.name,
      start: parseLocalDate(opp.date),
      end: parseLocalDate(opp.date),
      allDay: true,
      resource: {
        type: 'opportunity' as const,
        color: EVENT_COLOR,
        data: opp,
      },
    })),
    ...campaigns
      .filter((c) => c.start_date != null)
      .flatMap((c) => {
        const start = parseLocalDate(c.start_date!)
        const endRaw = c.end_date ? parseLocalDate(c.end_date) : new Date(start)
        const totalDays = Math.ceil((endRaw.getTime() - start.getTime()) / 86_400_000) + 1
        const color = c.color ?? CAMPAIGN_DEFAULT_COLOR
        return Array.from({ length: totalDays }, (_, i) => {
          const day = new Date(start)
          day.setDate(day.getDate() + i)
          // `day` is local midnight; toISOString() would shift it a day back in
          // any UTC+ zone (IST = UTC+5:30) and miss the local-dated dayInfoMap key.
          const dateStr = format(day, 'yyyy-MM-dd')
          const info = dayInfoMap[`${c.id}-${dateStr}`]
          const theme = info?.theme ?? null
          const vehicle = info?.vehicle ?? null
          return {
            id: `${c.id}-d${i}`,
            title: c.name,
            start: day,
            end: day,
            allDay: true,
            resource: {
              type: 'campaign' as const,
              color,
              data: c,
              dayNum: i + 1,
              totalDays,
              theme,
              vehicle,
            },
          }
        })
      }),
  ], [currentOpportunities, campaigns, dayInfoMap])

  // Custom event renderer — shows campaign name + daily theme per cell
  const calendarComponents = useMemo(() => ({
    event: ({ event }: { event: object }) => {
      const e = event as CalEvent
      if (e.resource.type === 'campaign') {
        const line2 = e.resource.theme
          ? (e.resource.vehicle ? `${e.resource.theme} · ${e.resource.vehicle}` : e.resource.theme)
          : `Day ${e.resource.dayNum}`
        return (
          <div className="leading-[1.2] truncate px-0.5 text-white">
            <div className="font-semibold truncate" style={{ fontSize: '9px' }}>
              {(e.resource.data as CampaignSummary).name}
            </div>
            <div className="opacity-80 truncate" style={{ fontSize: '8px' }}>
              {line2}
            </div>
          </div>
        )
      }
      return <div className="truncate px-0.5" style={{ fontSize: '9px' }}>{e.title}</div>
    },
  }), [])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openDetail = (c: CampaignSummary) => {
    setDetailCampaign(c)
    setDetailOpen(true)
  }

  const navigateTo = async (newMonth: number, newYear: number) => {
    setSelectedOpp(null)
    setLoadingPlan(true)
    try {
      // Auto-generates AI content for any pending events — idempotent.
      const plan = await getMonthEvents({ data: { month: newMonth, year: newYear } })
      setMonth(newMonth)
      setYear(newYear)
      setMonthPlan(plan)
    } catch (err) {
      // Callers don't await navigateTo, so a rejection here used to surface only as
      // an unhandled promise rejection while the view sat on the old month with no
      // feedback. Keep the old month, tell the user, log for triage.
      console.error('[campaign-planner] getMonthEvents failed:', err)
      toast.error('Could not load that month. Please try again.')
    } finally {
      setLoadingPlan(false)
    }
  }

  const prevMonth = () => (month === 1 ? navigateTo(12, year - 1) : navigateTo(month - 1, year))
  const nextMonth = () => (month === 12 ? navigateTo(1, year + 1) : navigateTo(month + 1, year))

  const openWizard = (defaults: typeof wizardDefaults = {}) => {
    setWizardDefaults(defaults)
    setWizardOpen(true)
  }

  // react-big-calendar callbacks
  const eventPropGetter = (event: object) => {
    const e = event as CalEvent
    return {
      style: {
        backgroundColor: e.resource.color,
        border: 'none',
      } as React.CSSProperties,
    }
  }

  const handleSelectSlot = ({ start }: { start: Date }) => {
    const d = start.getDate()
    const m = start.getMonth() + 1
    const y = start.getFullYear()
    if (m !== month || y !== year) return
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const opp = currentOpportunities.find((o) => o.date === iso)
    openWizard(opp
      ? { start_date: iso, notes: opp.name, campaign_name: opp.theme }
      : { start_date: iso }
    )
  }

  const handleSelectEvent = (event: object) => {
    const e = event as CalEvent
    if (e.resource.type === 'campaign') {
      openDetail(e.resource.data as CampaignSummary)
    } else {
      setSelectedOpp(e.resource.data as MonthPlan['opportunities'][0])
    }
  }

  const handleNavigate = (newDate: Date) => {
    const m = newDate.getMonth() + 1
    const y = newDate.getFullYear()
    if (m !== month || y !== year) navigateTo(m, y)
  }

  const calDate = new Date(year, month - 1, 1)

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    // Break out of AppShell's px-6 py-7 wrapper (which has no height) so we can
    // own the full viewport height below the TopBar (h-16 = 64px).
    <div className="flex flex-col overflow-hidden -mx-6 -my-7" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div>
          <h1 className="text-[24px] font-bold text-foreground">Campaign Planner</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Nissan dealer campaigns — festivals, model launches, service promotions</p>
        </div>
        <button
          onClick={() => openWizard()}
          className="flex items-center gap-2 rounded-[12px] bg-[#C3002F] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#a50027] transition"
        >
          <Zap className="h-4 w-4" />
          New Campaign
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        {/* Calendar */}
        <div className="flex flex-1 flex-col min-h-0 p-6 gap-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                disabled={loadingPlan}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border hover:bg-muted transition disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={nextMonth}
                disabled={loadingPlan}
                className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border hover:bg-muted transition disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-[16px] font-bold text-foreground ml-1 flex items-center gap-2">
                {MONTH_NAMES[month]} {year}
                {loadingPlan && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: EVENT_COLOR }} />
                <span className="text-muted-foreground">Monthly Event</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: CAMPAIGN_DEFAULT_COLOR }} />
                <span className="text-muted-foreground">Campaign</span>
              </span>
            </div>
          </div>

          {/* react-big-calendar — relative+absolute inset pattern gives Calendar
              a definite pixel height regardless of flex ancestor chain */}
          <div
            className={cn(
              'rbc-brand relative flex-1 min-h-0 rounded-[18px] border-2 border-border overflow-hidden bg-white',
              loadingPlan && 'opacity-50 pointer-events-none transition-opacity',
            )}
          >
            <div className="absolute inset-0">
              <Calendar
                localizer={localizer}
                events={events}
                date={calDate}
                defaultView={Views.MONTH}
                views={[Views.MONTH]}
                toolbar={false}
                selectable
                showAllEvents
                longPressThreshold={10}
                onSelectSlot={handleSelectSlot}
                onSelectEvent={handleSelectEvent}
                onNavigate={handleNavigate}
                eventPropGetter={eventPropGetter}
                components={calendarComponents}
                style={{ height: '100%' }}
              />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-72 shrink-0 border-l border-border flex flex-col overflow-y-auto p-4 space-y-4">
          {selectedOpp ? (
            <>
              <div>
                <button onClick={() => setSelectedOpp(null)} className="text-[11px] text-muted-foreground hover:text-foreground mb-2">← Back</button>
                <div className="rounded-[12px] border border-border p-4">
                  <span
                    className="inline-block text-[10px] font-bold text-white px-2 py-0.5 rounded-full mb-2 capitalize"
                    style={{ background: EVENT_COLOR }}
                  >
                    {selectedOpp.kind}
                  </span>
                  <h3 className="text-[14px] font-bold text-foreground">{selectedOpp.name}</h3>
                  <p className="text-[12px] font-semibold text-[#C3002F] mt-1">{selectedOpp.theme}</p>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">{selectedOpp.suggestion}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">{selectedOpp.date.substring(0, 10)}</p>
                  {selectedOpp.content_status && selectedOpp.content_status !== 'pending' && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-[8px] bg-green-50 border border-green-200 px-2 py-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                      <p className="text-[10px] font-semibold text-green-700">
                        AI post content ready — review in Content Studio
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setSelectedOpp(null)
                    openWizard({
                      campaign_name: selectedOpp.theme,
                      notes: selectedOpp.name,
                      start_date: selectedOpp.date.substring(0, 10),
                    })
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#C3002F] px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-[#a50027] transition"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Plan this Campaign
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  {MONTH_NAMES[month]} {year} Opportunities
                </p>
                {currentOpportunities.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No opportunities this month.</p>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-2 pr-0.5">
                    {currentOpportunities.map((opp) => (
                      <button
                        key={opp.date + opp.name}
                        onClick={() => setSelectedOpp(opp)}
                        className="w-full text-left rounded-[10px] border border-border p-3 hover:border-[#C3002F] hover:bg-[#FFF8F8] transition"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: EVENT_COLOR }} />
                          <span className="text-[11px] font-semibold text-foreground flex-1 min-w-0 truncate">{opp.name}</span>
                          {opp.content_status && opp.content_status !== 'pending' && (
                            <span className="shrink-0 text-[8px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">AI ✓</span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground pl-4">{parseInt(opp.date.substring(8, 10))} {MONTH_NAMES[month]}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Campaigns <span className="text-muted-foreground font-normal">({campaigns.length})</span>
                </p>
                {campaigns.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No campaigns yet.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                    {campaigns.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openDetail(c)}
                        className="w-full text-left rounded-[10px] border border-border p-3 hover:border-[#C3002F] hover:bg-[#FFF8F8] transition"
                      >
                        <p className="text-[11px] font-semibold text-foreground truncate">{c.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={cn(
                              'text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize',
                              c.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600',
                            )}
                          >
                            {c.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{c.postCount} posts</span>
                        </div>
                        {c.start_date && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {c.start_date}{c.end_date && c.end_date !== c.start_date ? ` → ${c.end_date}` : ''}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <CampaignPlannerWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        defaultValues={wizardDefaults}
      />

      <CampaignDetailDialog
        campaign={detailCampaign}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDeleted={(id) => {
          setCampaigns((prev) => prev.filter((c) => c.id !== id))
          setCampaignDays((prev) => prev.filter((d) => d.campaign_id !== id))
          setDetailCampaign(null)
          setDetailOpen(false)
          void router.invalidate()
        }}
      />
    </div>
  )
}
