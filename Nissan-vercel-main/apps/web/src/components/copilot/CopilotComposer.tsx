import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '#/lib/utils'

export function CopilotComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void
  disabled: boolean
}) {
  const [value, setValue] = useState('')

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-card transition focus-within:border-[var(--ring)] focus-within:shadow-[0_1px_2px_rgba(16,24,40,0.05),0_18px_40px_-18px_rgba(16,24,40,0.22)]">
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask your dealership anything…"
            className="max-h-40 min-h-[2.4rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition',
              canSend
                ? 'brand-bg hover:opacity-90'
                : 'bg-muted text-muted-foreground/50',
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground/60">
          Press <kbd className="font-semibold">⌘</kbd>/<kbd className="font-semibold">Ctrl</kbd> +{' '}
          <kbd className="font-semibold">Enter</kbd> to send · grounded in your live dealership data
        </p>
      </div>
    </div>
  )
}
