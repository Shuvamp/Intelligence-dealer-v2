import { CalendarDays } from 'lucide-react'
import type { AnalyticsPreset, AnalyticsRange } from '#/lib/marketing'

const PRESETS: Array<{ key: AnalyticsPreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
]

// Global date filter — every dashboard section reads the selected range.
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: AnalyticsRange
  onChange: (r: AnalyticsRange) => void
}) {
  const today = new Date().toISOString().substring(0, 10)
  return (
    <div className="rounded-[14px] border border-[#E5E7EB] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 pr-1 text-[#9CA3AF]">
          <CalendarDays className="h-4 w-4" />
          <span className="text-[11px] font-semibold uppercase tracking-wide">Period</span>
        </div>
        {PRESETS.map((p) => {
          const on = value.preset === p.key
          return (
            <button
              key={p.key}
              onClick={() => onChange({ preset: p.key, from: value.from, to: value.to })}
              className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition ${
                on
                  ? 'bg-[#C3002F] text-white'
                  : 'border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F9FAFB]'
              }`}
            >
              {p.label}
            </button>
          )
        })}

        {value.preset === 'custom' && (
          <div className="flex items-center gap-2 pl-1">
            <input
              type="date"
              max={value.to || today}
              value={value.from ?? ''}
              onChange={(e) => onChange({ ...value, preset: 'custom', from: e.target.value })}
              className="rounded-[8px] border border-[#E5E7EB] px-2 py-1.5 text-[12px] text-[#1A1A1A]"
            />
            <span className="text-[12px] text-[#9CA3AF]">to</span>
            <input
              type="date"
              min={value.from || undefined}
              max={today}
              value={value.to ?? ''}
              onChange={(e) => onChange({ ...value, preset: 'custom', to: e.target.value })}
              className="rounded-[8px] border border-[#E5E7EB] px-2 py-1.5 text-[12px] text-[#1A1A1A]"
            />
          </div>
        )}
      </div>
    </div>
  )
}
