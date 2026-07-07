import type { LucideIcon } from 'lucide-react'
import { Panel } from '#/components/ui/kit'

export function PlaceholderPage({
  title,
  icon: Icon,
  description,
  bullets,
}: {
  title: string
  icon: LucideIcon
  description: string
  bullets: Array<string>
}) {
  return (
    <div className="fade-up">
      <div className="kicker text-muted-foreground/70">Module</div>
      <h1 className="mt-1 text-[26px] font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1.5 max-w-xl text-[14px] text-muted-foreground">{description}</p>

      <Panel className="mt-6 overflow-hidden">
        <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[color-mix(in_oklab,var(--brand)_10%,transparent)]">
            <Icon className="h-7 w-7 brand-text" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-foreground">Coming in this module</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Built on the live multi-tenant foundation — wiring next.
            </p>
          </div>
          <ul className="mt-1 grid max-w-md gap-2 text-left sm:grid-cols-2">
            {bullets.map((b) => (
              <li
                key={b}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] text-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full brand-bg" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  )
}
