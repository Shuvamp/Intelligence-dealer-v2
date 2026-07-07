import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { createCampaign } from '#/lib/marketing'
import type { CampaignObjective, CampaignSummary } from '#/lib/types'
import { Loader2 } from 'lucide-react'

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const OBJECTIVES: Array<{ value: CampaignObjective; label: string; color: string }> = [
  { value: 'awareness', label: 'Awareness', color: '#1877F2' },
  { value: 'lead_gen', label: 'Lead Gen', color: '#16A34A' },
  { value: 'offer', label: 'Offer', color: '#D97706' },
  { value: 'festival', label: 'Festival', color: '#C3002F' },
  { value: 'launch', label: 'Launch', color: '#7C3AED' },
]

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  date: string | null
  initialName?: string
  onCreated: (newCampaign: CampaignSummary) => void
}

export function QuickCampaignDialog({ open, onOpenChange, date, initialName = '', onCreated }: Props) {
  const [name, setName] = useState(initialName)
  const [objective, setObjective] = useState<CampaignObjective>('awareness')
  const [endDate, setEndDate] = useState(date ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(initialName)
      setObjective('awareness')
      setEndDate(date ?? '')
      setError('')
      setLoading(false)
    }
  }, [open, date, initialName])

  const dateLabel = (() => {
    if (!date) return ''
    const [y, m, d] = date.split('-')
    return `${parseInt(d)} ${MONTH_NAMES[parseInt(m)]} ${y}`
  })()

  const handleCreate = async () => {
    if (!name.trim()) { setError('Campaign name is required'); return }
    if (!date) return
    setLoading(true)
    setError('')
    try {
      const result = await createCampaign({
        data: {
          name: name.trim(),
          objective,
          start_date: date,
          end_date: endDate || date,
          channels: ['instagram'],
        },
      })
      // Optimistic update — show the campaign immediately from the returned row
      onCreated(result.campaign as CampaignSummary)
      onOpenChange(false)
    } catch (e: any) {
      setError(e.message || 'Failed to create campaign')
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px]">New Campaign</DialogTitle>
        </DialogHeader>

        <div className="mt-1 space-y-4">
          <div className="inline-flex items-center rounded-full bg-[#FFF0F3] px-3 py-1">
            <span className="text-[11px] font-semibold text-[#C3002F]">{dateLabel}</span>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-foreground">
              Campaign Name <span className="text-[#C3002F]">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleCreate()}
              placeholder="e.g. Independence Day Magnite Drive"
              className="w-full rounded-[10px] border border-border px-3 py-2 text-[13px] outline-none focus:border-[#C3002F] focus:ring-1 focus:ring-[#C3002F]/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Objective</label>
            <div className="flex flex-wrap gap-1.5">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setObjective(o.value)}
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold transition"
                  style={
                    objective === o.value
                      ? { background: o.color, borderColor: o.color, color: '#fff' }
                      : { background: 'transparent', borderColor: '#e5e7eb', color: '#6b7280' }
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-foreground">End Date</label>
            <input
              type="date"
              value={endDate}
              min={date ?? ''}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-[10px] border border-border px-3 py-2 text-[13px] outline-none focus:border-[#C3002F] focus:ring-1 focus:ring-[#C3002F]/20"
            />
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold transition hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="flex items-center gap-2 rounded-[10px] bg-[#C3002F] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#a50027] disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
