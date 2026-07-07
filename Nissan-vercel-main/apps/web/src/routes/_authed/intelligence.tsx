import { createFileRoute } from '@tanstack/react-router'
import {
  getIntelligenceOverview, getSignals, getTopRecommendations, getLeadSourceAnalytics,
  getPipelineFunnel, getVehicleDemand, getRegionalDemand, getCampaignPerformance,
} from '#/lib/intelligence'
import { StatTile } from '#/components/intelligence/intelligence-ui'
import {
  SignalsPanel, RecommendationsPanel, SourcePanel, FunnelPanel, DemandPanel, CampaignPanel,
} from '#/components/intelligence/intel-sections'

export const Route = createFileRoute('/_authed/intelligence')({
  loader: async () => {
    const [overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns] =
      await Promise.all([
        getIntelligenceOverview(), getSignals(), getTopRecommendations(), getLeadSourceAnalytics(),
        getPipelineFunnel(), getVehicleDemand(), getRegionalDemand(), getCampaignPerformance(),
      ])
    return { overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns }
  },
  component: IntelligencePage,
})

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

function IntelligencePage() {
  const { overview, signals, recommendations, sources, funnel, vehicles, regions, campaigns } =
    Route.useLoaderData()

  return (
    <div className="space-y-7">
      {/* Header */}
      <header className="fade-up">
        <div className="kicker text-muted-foreground/70">Market Intelligence</div>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">
          Intelligence
        </h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Signals and trends from your dealership data
        </p>
      </header>

      {/* Overview stat tiles */}
      <div
        className="fade-up grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
        style={{ animationDelay: '60ms' }}
      >
        <StatTile label="Total Leads" value={overview.totalLeads.toLocaleString('en-IN')} accent="brand" />
        <StatTile label="Conversion Rate" value={`${overview.conversionRate}%`} accent="emerald" />
        <StatTile label="Top Source" value={overview.topSource} sub="most leads" accent="sky" />
        <StatTile label="Top Vehicle" value={overview.topVehicle} sub="most interest" accent="amber" />
        <StatTile label="Pipeline Value" value={fmtINR(overview.pipelineValue)} sub="open deals" accent="brand" />
        <StatTile label="Best Campaign" value={overview.bestCampaign} sub="by leads" accent="emerald" />
      </div>

      {/* Signals + Recommendations (hero) */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-7">
          <SignalsPanel signals={signals} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <RecommendationsPanel recommendations={recommendations} />
        </div>
      </div>

      {/* Analytics grid */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-5">
          <SourcePanel sources={sources} />
        </div>
        <div className="col-span-12 lg:col-span-7">
          <FunnelPanel funnel={funnel} />
        </div>

        <div className="col-span-12 lg:col-span-6">
          <DemandPanel title="Vehicle Demand" kicker="Inventory signal" items={vehicles} delay={360} />
        </div>
        <div className="col-span-12 lg:col-span-6">
          <DemandPanel title="Regional Demand" kicker="Geography" items={regions} delay={360} />
        </div>

        <div className="col-span-12">
          <CampaignPanel campaigns={campaigns} />
        </div>
      </div>
    </div>
  )
}
