import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { StickyNote, Phone, MessageCircle, Loader2, Send, type LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/kit'
import { addLeadEvent } from '#/lib/leads'
import type { LeadEventType } from '#/lib/types'

const COMPOSER_TYPES: Array<{ type: Extract<LeadEventType, 'note' | 'call' | 'whatsapp'>; label: string; icon: LucideIcon; placeholder: string }> = [
  { type: 'note', label: 'Note', icon: StickyNote, placeholder: 'Add a private note about this lead…' },
  { type: 'call', label: 'Call', icon: Phone, placeholder: 'What happened on the call?' },
  { type: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, placeholder: 'Summarise the WhatsApp exchange…' },
]

export function EventComposer({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [type, setType] = useState<'note' | 'call' | 'whatsapp'>('note')
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)

  const active = COMPOSER_TYPES.find((t) => t.type === type)!

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const summary = text.trim()
    if (!summary || pending) return
    setPending(true)
    try {
      await addLeadEvent({ data: { lead_id: leadId, type, summary, metadata: {} } })
      setText('')
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-border px-5 py-4">
      <div className="flex flex-wrap gap-1.5">
        {COMPOSER_TYPES.map((t) => {
          const Icon = t.icon
          const selected = t.type === type
          return (
            <button
              key={t.type}
              type="button"
              onClick={() => setType(t.type)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition',
                selected
                  ? 'brand-bg'
                  : 'border border-border bg-card text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={active.placeholder}
          rows={2}
          disabled={pending}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e)
          }}
          className="min-h-[2.6rem] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] text-foreground transition focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/20 disabled:opacity-60"
        />
        <Button type="submit" variant="brand" disabled={pending || !text.trim()} className="h-[2.6rem] shrink-0">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {pending ? 'Logging…' : 'Log'}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground/60">⌘/Ctrl + Enter to log activity</p>
    </form>
  )
}
