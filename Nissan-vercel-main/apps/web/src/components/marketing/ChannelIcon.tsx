import { cn } from '#/lib/utils'

// Real brand-logo glyphs for each publishing channel, rendered as inline SVG
// inside a rounded tile. lucide-react dropped brand marks, so we hand-roll the
// paths here. Keep the tile sizing here — callers just pass `channel`.
type ChannelKey = 'instagram' | 'facebook' | 'linkedin' | 'google_business' | 'whatsapp'

export function ChannelIcon({
  channel,
  className,
}: {
  channel: string
  className?: string
}) {
  const tile = cn(
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] shadow-sm',
    className,
  )

  switch (channel as ChannelKey) {
    case 'instagram':
      return (
        <div className={tile} style={{ background: '#DD2A7B' }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
            <defs>
              <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#F58529" />
                <stop offset="45%" stopColor="#DD2A7B" />
                <stop offset="100%" stopColor="#8134AF" />
              </linearGradient>
              <clipPath id="ig-clip">
                <rect width="24" height="24" rx="6" />
              </clipPath>
            </defs>
            <g clipPath="url(#ig-clip)">
              <rect width="24" height="24" fill="url(#ig-grad)" />
              <g fill="none" stroke="#fff" strokeWidth="1.6">
                <rect x="5" y="5" width="14" height="14" rx="4.4" />
                <circle cx="12" cy="12" r="3.4" />
              </g>
              <circle cx="16.4" cy="7.6" r="1.05" fill="#fff" />
            </g>
          </svg>
        </div>
      )

    case 'linkedin':
      return (
        <div className={tile} style={{ background: '#0A66C2' }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff" aria-hidden>
            <path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0-.02-5ZM3 9.5h4V21H3V9.5Zm6.5 0h3.8v1.57h.05c.53-.95 1.82-1.95 3.75-1.95 4 0 4.75 2.5 4.75 5.75V21h-4v-5.1c0-1.22-.02-2.8-1.7-2.8-1.7 0-1.96 1.32-1.96 2.7V21h-4V9.5Z" />
          </svg>
        </div>
      )

    case 'facebook':
      return (
        <div className={tile} style={{ background: '#1877F2' }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff" aria-hidden>
            <path d="M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.3C16.6 2.2 15.6 2 14.5 2 11.9 2 10.3 3.6 10.3 6.4v2.1H8V12h2.3v9H14v-9h2.6l.4-3.5H14Z" />
          </svg>
        </div>
      )

    case 'google_business':
      return (
        <div className={cn(tile, 'border border-border')} style={{ background: '#fff' }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
            <path fill="#4285F4" d="M23 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72C21.78 18.9 23 15.9 23 12.27Z" />
            <path fill="#34A853" d="M12 23c3.1 0 5.7-1.03 7.6-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.88 1.1-2.98 0-5.5-2.01-6.4-4.72H1.76v2.98A11.5 11.5 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.6 13.7a6.9 6.9 0 0 1 0-4.4V6.32H1.76a11.5 11.5 0 0 0 0 10.36L5.6 13.7Z" />
            <path fill="#EA4335" d="M12 4.58c1.68 0 3.19.58 4.38 1.71l3.28-3.28C17.7 1.14 15.1 0 12 0A11.5 11.5 0 0 0 1.76 6.32L5.6 9.3C6.5 6.59 9.02 4.58 12 4.58Z" />
          </svg>
        </div>
      )

    case 'whatsapp':
      return (
        <div className={tile} style={{ background: '#25D366' }}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff" aria-hidden>
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.32-1.95 1.36-.5.05-.98.24-3.36-.7-2.84-1.12-4.63-4-4.77-4.19-.14-.19-1.14-1.52-1.14-2.9s.72-2.06.98-2.34c.24-.28.53-.35.71-.35l.5.01c.16 0 .38-.06.59.45.24.58.79 2 .86 2.14.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.19-.3.42-.43.56-.14.14-.29.3-.13.58.16.28.72 1.19 1.55 1.93 1.07.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.69-.8.88-1.08.19-.28.37-.23.62-.14.25.09 1.6.76 1.87.9.28.14.46.21.53.33.07.12.07.68-.17 1.36Z" />
          </svg>
        </div>
      )

    default:
      return <div className={cn(tile, 'bg-muted')} aria-hidden />
  }
}
