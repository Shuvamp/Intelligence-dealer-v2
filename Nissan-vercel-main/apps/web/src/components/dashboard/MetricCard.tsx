import { TrendingUp } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { HeroMetric } from '#/lib/demo-metrics'

const TONE_ACCENT: Record<HeroMetric['tone'], string> = {
  brand: 'before:bg-[var(--brand)]',
  amber: 'before:bg-amber-400',
  emerald: 'before:bg-emerald-400',
  sky: 'before:bg-sky-400',
  neutral: 'before:bg-zinc-300',
}

export function MetricCard({
  metric,
  index = 0,
}: {
  metric: HeroMetric
  index?: number
}) {
  return (
    <div
      className={cn(
        'fade-up relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition hover:shadow-float',
        'before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-[""]',
        TONE_ACCENT[metric.tone],
      )}
      style={{ animationDelay: `${80 + index * 60}ms` }}
    >
      <div className="text-[12px] font-semibold text-muted-foreground">{metric.label}</div>
      <div className="mt-2 flex items-end gap-2">
        <div className="num text-[30px] font-bold leading-none text-foreground">
          {metric.value}
        </div>
        {metric.trend ? (
          <span className="mb-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600">
            <TrendingUp className="h-3 w-3" />
            {metric.trend}
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground/80">{metric.sublabel}</div>
    </div>
  )
}
