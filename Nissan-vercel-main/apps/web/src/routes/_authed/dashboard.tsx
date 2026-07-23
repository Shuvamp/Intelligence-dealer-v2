import { useEffect, useRef } from 'react'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { HeroSection } from '#/components/dashboard/HeroSection'
import { AiRecommendations } from '#/components/dashboard/AiRecommendations'
import { ConversionKpis } from '#/components/dashboard/ConversionKpis'
import { LeadFunnel } from '#/components/dashboard/LeadFunnel'
import { ConversionTrend } from '#/components/dashboard/ConversionTrend'
import { MarketingPulse } from '#/components/dashboard/MarketingPulse'
import { DateRangeFilter } from '#/components/marketing/analytics/DateRangeFilter'
import { getLeadConversionAnalytics, getMarketingPulse } from '#/lib/queries'
import { getTopRecommendations } from '#/lib/intelligence'
import type { AnalyticsPreset, AnalyticsRange } from '#/lib/marketing'

// Day/week/month conversion filter lives in the URL → shareable, and changing
// it re-runs the loader against real, RLS-scoped data.
const PRESETS: ReadonlyArray<AnalyticsPreset> = [
  'today', 'last7', 'last30', 'this_month', 'last_month', 'this_year', 'custom',
]

export const Route = createFileRoute('/_authed/dashboard')({
  validateSearch: (s: Record<string, unknown>): AnalyticsRange => ({
    preset: PRESETS.includes(s['preset'] as AnalyticsPreset) ? (s['preset'] as AnalyticsPreset) : 'last30',
    from: typeof s['from'] === 'string' ? s['from'] : undefined,
    to: typeof s['to'] === 'string' ? s['to'] : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [conversion, pulse, recommendations] = await Promise.all([
      getLeadConversionAnalytics({ data: deps }),
      getMarketingPulse(),
      getTopRecommendations(),
    ])
    return { conversion, pulse, recommendations }
  },
  component: Dashboard,
})

const authed = getRouteApi('/_authed')

function Dashboard() {
  const { user } = authed.useRouteContext()
  const { dashboard } = authed.useLoaderData()
  const { conversion, pulse, recommendations } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const esRef = useRef<EventSource | null>(null)

  // Live: intake pipeline pushes new_lead / stage_change → re-run the loader so
  // conversion numbers and the funnel update in place.
  useEffect(() => {
    const apiUrl =
      (import.meta.env as Record<string, string>).VITE_AGENT_API_URL ?? 'http://localhost:8000'
    const es = new EventSource(`${apiUrl}/intake/stream`)
    esRef.current = es
    es.onmessage = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string) as { type: string }
        if (payload.type === 'new_lead' || payload.type === 'stage_change') void router.invalidate()
      } catch {}
    }
    es.onerror = () => {
      // CONNECTING = the browser is already retrying; that's normal churn on
      // navigation/HMR. Only a CLOSED stream is worth reporting.
      if (es.readyState === EventSource.CLOSED) {
        console.warn('[Dashboard] SSE connection closed')
      }
    }
    return () => {
      es.close()
      esRef.current = null
    }
  }, [router])

  const setRange = (r: AnalyticsRange) =>
    navigate({ search: (prev) => ({ ...prev, preset: r.preset, from: r.from, to: r.to }), replace: true })

  const focus = `${conversion.totalLeads} leads in this period, ${conversion.won} converted (${conversion.conversionRate}%). ${conversion.open} still in the pipeline.`

  return (
    <div className="space-y-6">
      <HeroSection name={user.profile.full_name} focus={focus} />

      <DateRangeFilter value={search} onChange={setRange} />

      <ConversionKpis data={conversion} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LeadFunnel data={conversion} />
        <ConversionTrend data={conversion} />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-7">
          <AiRecommendations recommendations={recommendations} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <MarketingPulse pulse={pulse} notifications={dashboard.notifications} />
        </div>
      </div>
    </div>
  )
}
