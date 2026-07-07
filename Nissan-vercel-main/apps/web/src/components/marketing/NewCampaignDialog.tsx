import { useState, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { createCampaign } from '#/lib/marketing'

interface DefaultValues {
  name?: string
  theme?: string
  start_date?: string
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultValues?: DefaultValues
}

const OBJECTIVES = [
  { value: 'awareness', label: 'Awareness' },
  { value: 'lead_gen', label: 'Lead Generation' },
  { value: 'offer', label: 'Offer / Promotion' },
  { value: 'festival', label: 'Festival' },
  { value: 'launch', label: 'Model Launch' },
]

const CHANNELS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'google_business', label: 'Google Business' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export function NewCampaignDialog({ open, onOpenChange, defaultValues }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('awareness')
  const [theme, setTheme] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [budget, setBudget] = useState('')
  const [channels, setChannels] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setName(defaultValues?.name ?? '')
      setTheme(defaultValues?.theme ?? '')
      setStartDate(defaultValues?.start_date ?? '')
      setEndDate('')
      setBudget('')
      setChannels([])
      setObjective('awareness')
    }
  }, [open, defaultValues])

  const toggleChannel = (ch: string) =>
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await createCampaign({
        data: {
          name: name.trim(),
          objective,
          theme: theme.trim() || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          channels,
          budget: budget ? Number(budget) : undefined,
        },
      })
      await router.invalidate()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div>
            <label className="block text-[12px] font-semibold text-foreground mb-1">
              Campaign Name <span className="text-[#C3002F]">*</span>
            </label>
            <input
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Diwali Magnite Push"
              required
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-foreground mb-1">
              Objective
            </label>
            <select
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            >
              {OBJECTIVES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-foreground mb-1">
              Theme{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="e.g. Light Up Your Driveway"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-foreground mb-1">
                Start Date
              </label>
              <input
                type="date"
                className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-foreground mb-1">
                End Date
              </label>
              <input
                type="date"
                className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-foreground mb-2">
              Channels
            </label>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((ch) => (
                <button
                  key={ch.value}
                  type="button"
                  onClick={() => toggleChannel(ch.value)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    channels.includes(ch.value)
                      ? 'border-[#C3002F] bg-[#FFF8F8] text-[#C3002F]'
                      : 'border-border bg-background text-muted-foreground hover:border-[#C3002F]/50'
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-foreground mb-1">
              Budget ₹{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              type="number"
              min={0}
              className="w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#C3002F]/30 focus:border-[#C3002F]"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 50000"
            />
          </div>

          <DialogFooter className="pt-2" showCloseButton>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 rounded-[10px] bg-[#C3002F] px-5 py-2 text-[13px] font-semibold text-white hover:bg-[#a50027] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Creating…' : 'Create Campaign'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
