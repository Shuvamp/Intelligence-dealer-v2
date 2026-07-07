import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { deleteCampaignById } from '#/lib/marketing'
import type { CampaignSummary } from '#/lib/types'
import { Loader2, Trash2 } from 'lucide-react'

const OBJECTIVE_COLOR: Record<string, string> = {
  awareness: '#1877F2',
  lead_gen: '#16A34A',
  offer: '#D97706',
  festival: '#C3002F',
  launch: '#7C3AED',
}

const OBJECTIVE_LABEL: Record<string, string> = {
  awareness: 'Awareness',
  lead_gen: 'Lead Generation',
  offer: 'Offer / Promo',
  festival: 'Festival',
  launch: 'Model Launch',
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-700',
  active: 'bg-green-50 text-green-700',
  completed: 'bg-purple-50 text-purple-700',
  archived: 'bg-gray-50 text-gray-400',
}

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${parseInt(d)} ${SHORT_MONTHS[parseInt(m)]} ${y}`
}

interface Props {
  campaign: CampaignSummary | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onDeleted?: (id: string) => void
}

export function CampaignDetailDialog({ campaign, open, onOpenChange, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async () => {
    if (!campaign) return
    setDeleting(true)
    try {
      await deleteCampaignById({ data: { id: campaign.id } })
      setConfirmDelete(false)
      setDeleting(false)
      onDeleted?.(campaign.id)
      onOpenChange(false)
    } catch {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (!campaign) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6 text-[16px] leading-snug">{campaign.name}</DialogTitle>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* Status + Objective badges */}
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CLASS[campaign.status] ?? STATUS_CLASS.draft}`}
            >
              {campaign.status}
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: OBJECTIVE_COLOR[campaign.objective] ?? '#6B7280' }}
            >
              {OBJECTIVE_LABEL[campaign.objective] ?? campaign.objective}
            </span>
          </div>

          {/* Dates */}
          <div className="rounded-[12px] border border-border p-3 space-y-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Start</span>
              <span className="font-semibold">{fmtDate(campaign.start_date)}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">End</span>
              <span className="font-semibold">{fmtDate(campaign.end_date)}</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-border p-3 text-center">
              <p className="text-[22px] font-bold text-foreground leading-none">{campaign.postCount}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Total Posts</p>
            </div>
            <div className="rounded-[12px] border border-border p-3 text-center">
              <p className="text-[22px] font-bold text-foreground leading-none">{campaign.publishedCount}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Published</p>
            </div>
          </div>

          {/* Theme */}
          {campaign.theme && (
            <div>
              <p className="text-[11px] text-muted-foreground">Theme</p>
              <p className="mt-0.5 text-[13px] font-semibold text-foreground">{campaign.theme}</p>
            </div>
          )}

          {/* Channels */}
          {campaign.channels?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] text-muted-foreground">Channels</p>
              <div className="flex flex-wrap gap-1.5">
                {campaign.channels.map((c) => (
                  <span key={c} className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="border-t border-border pt-3">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-red-200 px-4 py-2 text-[12px] font-semibold text-red-500 transition hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Campaign
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-[12px] text-foreground font-semibold">Delete this campaign?</p>
                <p className="text-center text-[11px] text-muted-foreground">This removes it from the calendar and DuckDB.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 rounded-[10px] border border-border py-2 text-[12px] font-semibold transition hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-red-500 py-2 text-[12px] font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                  >
                    {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
