import { createFileRoute } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { getReportsData } from '#/lib/reports'
import { Button } from '#/components/ui/kit'
import { StatTile } from '#/components/intelligence/intelligence-ui'
import { formatMoney } from '#/components/leads/lead-ui'
import {
  SourceROIPanel, CampaignROIPanel, TeamPanel,
} from '#/components/reports/reports-sections'

export const Route = createFileRoute('/_authed/reports')({
  loader: async () => ({ data: await getReportsData() }),
  component: ReportsPage,
})

function ReportsPage() {
  const { data } = Route.useLoaderData()
  const { sales, sources, campaigns, team } = data

  return (
    <div className="space-y-7">
      {/* Header */}
      <header className="fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="kicker text-muted-foreground/70">Reports</div>
          <h1 className="mt-1 font-display text-[26px] font-semibold tracking-tight text-foreground">
            Reports
          </h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Performance across leads, marketing and your team
          </p>
        </div>

        {/* Presentational toolbar — no handlers */}
        <div className="flex items-center gap-2.5">
          <select
            defaultValue="Last 30 days"
            aria-label="Date range"
            className="h-10 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground shadow-card transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>Year to date</option>
            <option>All time</option>
          </select>
          <Button variant="outline">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </header>

      {/* Sales Performance */}
      <section className="space-y-3">
        <div className="kicker text-muted-foreground/70">Sales Performance</div>
        <div
          className="fade-up grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
          style={{ animationDelay: '60ms' }}
        >
          <StatTile label="Total Leads" value={sales.totalLeads.toLocaleString('en-IN')} accent="brand" />
          <StatTile label="Won" value={sales.won.toLocaleString('en-IN')} sub={`${sales.lost} lost`} accent="emerald" />
          <StatTile label="Conversion Rate" value={`${sales.conversionRate}%`} sub="of closed deals" accent="sky" />
          <StatTile label="Pipeline Value" value={formatMoney(sales.pipelineValue)} sub="open deals" accent="amber" />
          <StatTile label="Won Value" value={formatMoney(sales.wonValue)} sub="closed revenue" accent="emerald" />
        </div>
      </section>

      {/* Channel ROI: sources + campaigns side by side */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-5">
          <SourceROIPanel sources={sources} />
        </div>
        <div className="col-span-12 lg:col-span-7">
          <CampaignROIPanel campaigns={campaigns} />
        </div>
      </div>

      {/* Team Performance */}
      <TeamPanel team={team} />
    </div>
  )
}
