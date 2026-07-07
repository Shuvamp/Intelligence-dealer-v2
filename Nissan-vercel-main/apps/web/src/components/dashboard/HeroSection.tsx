import { Sparkles } from 'lucide-react'

function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function HeroSection({
  name,
  focus,
}: {
  name: string
  focus: string
}) {
  const first = name.split(' ')[0]
  return (
    <section className="fade-up">
      <div className="kicker text-muted-foreground/70">
        {new Date().toLocaleDateString('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </div>
      <h1 className="mt-1.5 font-display text-[34px] leading-none text-foreground">
        {greeting()}, <span className="brand-text">{first}</span>
      </h1>
      <div className="mt-3 flex max-w-2xl items-start gap-2.5 rounded-xl border border-border bg-card/70 px-4 py-3 shadow-card">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 brand-text" />
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Today’s focus — </span>
          {focus}
        </p>
      </div>
    </section>
  )
}
