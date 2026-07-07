import { ArrowDownRight, ArrowUpRight, Flame, Trophy } from 'lucide-react'
import { Panel, PanelHeader, initials } from '#/components/ui/kit'
import { cn } from '#/lib/utils'
import { SourceTag, formatMoney } from '#/components/leads/lead-ui'
import type { ReportsData, UserRole } from '#/lib/types'

const ROLE_LABEL: Record<UserRole, string> = {
  dealer_owner: 'Owner',
  dealer_manager: 'Manager',
  sales_executive: 'Sales Executive',
  marketing_executive: 'Marketing Executive',
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="grid place-items-center px-5 py-12 text-center text-[12.5px] text-muted-foreground/80">
      {label}
    </div>
  )
}

// Conversion % chip with directional tone, reused across tables.
function ConvChip({ rate }: { rate: number }) {
  return (
    <span
      className={cn(
        'num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] font-semibold',
        rate >= 20
          ? 'bg-emerald-50 text-emerald-700'
          : rate >= 8
            ? 'bg-amber-50 text-amber-700'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {rate >= 20 ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : rate < 8 ? (
        <ArrowDownRight className="h-3 w-3" />
      ) : null}
      {rate}%
    </span>
  )
}

/** ---- Lead Source ROI ---- */
export function SourceROIPanel({ sources }: { sources: ReportsData['sources'] }) {
  return (
    <Panel className="fade-up h-full overflow-hidden" style={{ animationDelay: '180ms' }}>
      <PanelHeader
        kicker="Attribution"
        title="Lead Source ROI"
        action={
          <span className="num text-[12px] font-semibold text-muted-foreground">
            {sources.length} {sources.length === 1 ? 'channel' : 'channels'}
          </span>
        }
      />
      {sources.length === 0 ? (
        <EmptyRow label="No lead-source data yet." />
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              <th className="px-5 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
              <th className="px-3 py-2.5 text-right font-semibold">Won</th>
              <th className="px-5 py-2.5 text-right font-semibold">Conv.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sources.map((s) => (
              <tr key={s.source} className="text-[12.5px] transition-colors hover:bg-muted/40">
                <td className="px-5 py-3">
                  <SourceTag source={s.source} />
                </td>
                <td className="num px-3 py-3 text-right font-semibold text-foreground">{s.count}</td>
                <td className="num px-3 py-3 text-right text-muted-foreground">{s.won}</td>
                <td className="px-5 py-3 text-right">
                  <ConvChip rate={s.conversionRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

/** ---- Campaign Performance ---- */
export function CampaignROIPanel({ campaigns }: { campaigns: ReportsData['campaigns'] }) {
  return (
    <Panel className="fade-up h-full overflow-hidden" style={{ animationDelay: '240ms' }}>
      <PanelHeader
        kicker="Marketing ROI"
        title="Campaign Performance"
        action={
          <span className="num text-[12px] font-semibold text-muted-foreground">
            {campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}
          </span>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyRow label="No campaign insights captured yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                <th className="px-5 py-2.5 font-semibold">Campaign</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                <th className="px-3 py-2.5 text-right font-semibold">Conv.</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost / Lead</th>
                <th className="px-5 py-2.5 text-right font-semibold">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaigns.map((c, i) => (
                <tr key={`${c.name}-${i}`} className="text-[12.5px] transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="num px-3 py-3 text-right font-semibold text-foreground">{c.leads}</td>
                  <td className="px-3 py-3 text-right">
                    <ConvChip rate={Math.round(c.conversionRate)} />
                  </td>
                  <td className="num px-3 py-3 text-right text-muted-foreground">{formatMoney(c.costPerLead)}</td>
                  <td className="num px-5 py-3 text-right font-semibold text-foreground">{formatMoney(c.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** ---- Team Performance ---- */
export function TeamPanel({ team }: { team: ReportsData['team'] }) {
  return (
    <Panel className="fade-up overflow-hidden" style={{ animationDelay: '300ms' }}>
      <PanelHeader
        kicker="People"
        title="Team Performance"
        action={
          <span className="num text-[12px] font-semibold text-muted-foreground">
            {team.length} {team.length === 1 ? 'member' : 'members'}
          </span>
        }
      />
      {team.length === 0 ? (
        <EmptyRow label="No team activity to report yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                <th className="px-5 py-2.5 font-semibold">Member</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                <th className="px-3 py-2.5 text-right font-semibold">Won</th>
                <th className="px-3 py-2.5 text-right font-semibold">Hot</th>
                <th className="px-3 py-2.5 text-right font-semibold">Conv.</th>
                <th className="px-5 py-2.5 text-right font-semibold">Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {team.map((m, i) => {
                const isUnassigned = m.role === null
                const roleLabel = m.role ? ROLE_LABEL[m.role] : null
                return (
                  <tr key={`${m.name}-${i}`} className="text-[12.5px] transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                            isUnassigned
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] brand-text',
                          )}
                        >
                          {isUnassigned ? '–' : initials(m.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-foreground">{m.name}</span>
                            {i === 0 && !isUnassigned ? (
                              <Trophy className="h-3.5 w-3.5 text-amber-500" />
                            ) : null}
                          </div>
                          {roleLabel ? (
                            <div className="text-[11px] text-muted-foreground">{roleLabel}</div>
                          ) : (
                            <div className="text-[11px] text-muted-foreground/70">Unassigned</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="num px-3 py-3 text-right font-semibold text-foreground">{m.total}</td>
                    <td className="num px-3 py-3 text-right text-muted-foreground">{m.won}</td>
                    <td className="px-3 py-3 text-right">
                      {m.hot > 0 ? (
                        <span className="num inline-flex items-center gap-0.5 rounded-md bg-rose-50 px-1.5 py-0.5 text-[12px] font-semibold text-rose-700">
                          <Flame className="h-3 w-3" />
                          {m.hot}
                        </span>
                      ) : (
                        <span className="num text-muted-foreground/60">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ConvChip rate={m.conversionRate} />
                    </td>
                    <td className="num px-5 py-3 text-right font-semibold text-foreground">
                      {formatMoney(m.pipelineValue)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
