import { Globe } from 'lucide-react'
import type { ChannelConnection } from '#/lib/types'

// Canonical channel order + display meta.
export const CHANNELS: Array<{ key: string; label: string; color: string }> = [
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'instagram', label: 'Instagram', color: '#E1306C' },
  { key: 'google_business', label: 'Google Business', color: '#34A853' },
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
]

// Channel tabs. Only connected channels appear (empty channels are hidden);
// "All Channels" is always present and is the default.
export function ChannelFilter({
  value,
  onChange,
  connections,
}: {
  value: string
  onChange: (channel: string) => void
  connections: Array<ChannelConnection>
}) {
  const connectedKeys = new Set(
    connections.filter((c) => c.status === 'connected').map((c) => c.channel),
  )
  const tabs = CHANNELS.filter((c) => connectedKeys.has(c.key))

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#E5E7EB] bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 pr-1 text-[#9CA3AF]">
        <Globe className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">Channel</span>
      </div>

      <button
        onClick={() => onChange('all')}
        className={`rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition ${
          value === 'all' ? 'bg-[#1A1A1A] text-white' : 'border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F9FAFB]'
        }`}
      >
        All Channels
      </button>

      {tabs.map((c) => {
        const on = value === c.key
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition"
            style={{
              background: on ? c.color : '#fff',
              color: on ? '#fff' : '#4B5563',
              border: on ? `1px solid ${c.color}` : '1px solid #E5E7EB',
            }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : c.color }} />
            {c.label}
          </button>
        )
      })}

      {tabs.length === 0 && (
        <span className="text-[11px] text-[#9CA3AF]">No channels connected yet.</span>
      )}
    </div>
  )
}
