import { Download, GitCompare } from 'lucide-react'
import type { AnalyticsRange } from '#/lib/marketing'
import type { ChannelConnection } from '#/lib/types'
import { DateRangeFilter } from '#/components/marketing/analytics/DateRangeFilter'
import { ChannelFilter } from '#/components/marketing/analytics/ChannelFilter'

function Select({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] font-medium text-[#1A1A1A] outline-none transition-colors hover:border-[#C3002F] focus:border-[#C3002F]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function DashboardFilters({
  range, onRangeChange, channel, onChannelChange, connections,
  compareEnabled, onCompareToggle,
  campaignOptions, campaign, onCampaignChange,
  contentTypeOptions, contentType, onContentTypeChange,
  vehicleOptions, vehicle, onVehicleChange,
  onExport,
}: {
  range: AnalyticsRange
  onRangeChange: (r: AnalyticsRange) => void
  channel: string
  onChannelChange: (c: string) => void
  connections: Array<ChannelConnection>
  compareEnabled: boolean
  onCompareToggle: () => void
  campaignOptions: Array<{ value: string; label: string }>
  campaign: string
  onCampaignChange: (v: string) => void
  contentTypeOptions: Array<{ value: string; label: string }>
  contentType: string
  onContentTypeChange: (v: string) => void
  vehicleOptions: Array<{ value: string; label: string }>
  vehicle: string
  onVehicleChange: (v: string) => void
  onExport: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangeFilter value={range} onChange={onRangeChange} />
      <ChannelFilter value={channel} onChange={onChannelChange} connections={connections} />
      <Select value={campaign} onChange={onCampaignChange} options={campaignOptions} placeholder="All Campaigns" />
      <Select value={contentType} onChange={onContentTypeChange} options={contentTypeOptions} placeholder="All Content Types" />
      <Select value={vehicle} onChange={onVehicleChange} options={vehicleOptions} placeholder="All Vehicles" />
      <button
        onClick={onCompareToggle}
        className={`flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-medium transition-colors ${
          compareEnabled ? 'border-[#C3002F] bg-[#FDF2F4] text-[#C3002F]' : 'border-[#E5E7EB] text-[#4B5563] hover:border-[#C3002F]'
        }`}
      >
        <GitCompare className="h-3.5 w-3.5" /> Compare Period
      </button>
      <button
        onClick={onExport}
        className="ml-auto flex items-center gap-1.5 rounded-[10px] bg-[#1A1A1A] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-black"
      >
        <Download className="h-3.5 w-3.5" /> Export Report
      </button>
    </div>
  )
}
