import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  getChannelStatus,
  getLinkedInProfile,
  disconnectInstagram,
  disconnectLinkedIn,
  syncChannelConnection,
} from '#/lib/marketing'
import type { ChannelConnection, LinkedInState } from '#/lib/types'
import {
  CheckCircle2, XCircle, RefreshCw, ExternalLink, Loader2, AlertCircle,
  AlertTriangle, RotateCw, Link2, Network, Calendar, Lock, ChevronRight,
  MoreHorizontal, X,
} from 'lucide-react'
import { ChannelIcon } from '#/components/marketing/ChannelIcon'
import { Button, Badge, formatIN, formatINTime } from '#/components/ui/kit'

export const Route = createFileRoute('/_authed/connected-channels')({
  validateSearch: (search: Record<string, unknown>) => ({
    connected: (search.connected as string) ?? undefined,
    error: (search.error as string) ?? undefined,
  }),
  loader: async () => ({ channels: await getChannelStatus() }),
  component: ConnectedChannels,
})

const CHANNEL_META: Record<string, { label: string; color: string; bg: string; description: string }> = {
  instagram:       { label: 'Instagram',          color: '#E1306C', bg: '#FDF2F8', description: 'Post to Instagram Feed, Stories, and Reels automatically.' },
  facebook:        { label: 'Facebook',            color: '#1877F2', bg: '#EFF6FF', description: 'Publish posts and updates to your Facebook Business Page.' },
  linkedin:        { label: 'LinkedIn',            color: '#0A66C2', bg: '#EFF6FF', description: 'Share posts and updates to your LinkedIn Company Page.' },
  google_business: { label: 'Google Business',     color: '#34A853', bg: '#F0FDF4', description: 'Publish updates to your Google Business Profile listing.' },
  whatsapp:        { label: 'WhatsApp Business',   color: '#25D366', bg: '#F0FDF4', description: 'Send campaign messages to opted-in customers via WhatsApp.' },
}

// Known LinkedIn company/profile page for the demo tenant. Used when the LinkedIn
// The OIDC token (openid/profile/email/w_member_social) can't resolve the
// member's vanityName — /v2/me needs r_basicprofile — so profile_url is often
// null. When it is, open the member's LinkedIn feed, which is always valid for
// the signed-in user. (A hardcoded /in/<vanity> guess just 404s on LinkedIn.)
const LINKEDIN_PROFILE_FALLBACK = 'https://www.linkedin.com/feed/'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:            'You cancelled the Instagram authorization. Click Connect to try again.',
  redirect_uri_mismatch:    'OAuth redirect URI mismatch — check FACEBOOK_REDIRECT_URI in apps/api/.env matches your Meta app settings.',
  invalid_state:            'Session expired or request was tampered with. Please try again.',
  invalid_code:             'Authorization code expired or already used. Please start the connection again.',
  no_pages:                 'No Facebook Pages found on your account. You need a Facebook Page linked to an Instagram Business account.',
  no_instagram_account:     'No Instagram Business Account linked to your Facebook Page. Go to Meta Business Suite → Settings → Instagram to link one.',
  meta_api_error:           'Meta API returned an error. Check the API server logs.',
  callback_failed:          'An unexpected error occurred during connection. Check the API server logs.',
  missing_params:           'OAuth callback was missing required parameters. Please try again.',
  linkedin_access_denied:   'You cancelled the LinkedIn authorization. Click Connect to try again.',
  linkedin_invalid_code:    'LinkedIn authorization code expired or already used. Please start the connection again.',
  linkedin_api_error:       'LinkedIn API returned an error. Check the API server logs.',
  linkedin_callback_failed: 'An unexpected error occurred during LinkedIn connection. Check the API server logs.',
}

type ConnectState = 'idle' | 'connecting' | 'success' | 'error'

function ConnectedChannels() {
  const { channels } = Route.useLoaderData()
  const { connected, error: errorParam } = Route.useSearch()
  const router = useRouter()

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [connectState, setConnectState] = useState<Record<string, ConnectState>>({})

  const setChannelState = (ch: string, s: ConnectState) =>
    setConnectState(prev => ({ ...prev, [ch]: s }))

  const [igLocal, setIgLocal] = useState<{ handle?: string; instagram_business_account_id?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('ig_connection') ?? 'null') } catch { return null }
  })

  const [liLocal, setLiLocal] = useState<{ handle?: string; linkedin_id?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('linkedin_connection') ?? 'null') } catch { return null }
  })

  // Badge state + profile URL (profile details live in the dedicated page)
  const [linkedinState, setLinkedinState] = useState<LinkedInState | null>(null)
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState<string | null>(null)
  const [checkingLinkedIn, setCheckingLinkedIn] = useState(false)

  // Background token-verify on mount — sets badge + caches profile URL for quick open
  useEffect(() => {
    const li = channels.find((c: ChannelConnection) => c.channel === 'linkedin')
    if (li?.status === 'connected' || liLocal != null) {
      getLinkedInProfile()
        .then((res) => {
          setLinkedinState(res.state)
          setLinkedinProfileUrl(res.profile?.profile_url ?? null)
        })
        .catch(() => {})
    } else {
      setLinkedinState('not_connected')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goToLinkedInDetails = () =>
    router.navigate({ to: '/marketing/linkedin-channel' })

  const startLinkedInOAuth = async () => {
    setChannelState('linkedin', 'connecting')
    setBusy('linkedin-connect')
    try {
      // Dynamically import to avoid circular dep issues
      const { getLinkedInConnectUrl } = await import('#/lib/marketing')
      const url = await getLinkedInConnectUrl()
      window.location.href = url
    } catch {
      setChannelState('linkedin', 'error')
      setBanner({ type: 'error', message: 'Failed to start connection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

  // Click "Connect LinkedIn" / "Open LinkedIn" — check state first:
  //  connected          → open actual profile URL in new tab (NEVER navigate internally)
  //  reconnect_required → show banner prompting user to use Manage → Reconnect
  //  not_connected      → start OAuth
  //  error              → show banner
  const checkLinkedInThenAct = async () => {
    setCheckingLinkedIn(true)
    try {
      const res = await getLinkedInProfile()
      setLinkedinState(res.state)
      const url = res.profile?.profile_url ?? null
      setLinkedinProfileUrl(url)
      if (res.state === 'connected') {
        // Always open the real LinkedIn profile — resolved URL if available, else known fallback.
        // NEVER navigate to an internal details page here.
        window.open(url ?? LINKEDIN_PROFILE_FALLBACK, '_blank', 'noopener,noreferrer')
      } else if (res.state === 'reconnect_required') {
        // Token dead — restart OAuth directly (no internal page hop).
        await startLinkedInOAuth()
      } else if (res.state === 'not_connected') {
        await startLinkedInOAuth()
      } else {
        setBanner({ type: 'error', message: 'Could not reach LinkedIn. Check the API server and try again.' })
      }
    } finally {
      setCheckingLinkedIn(false)
    }
  }

  // postMessage from OAuth popup (if opened as popup in the future)
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const agentOrigin = (import.meta.env.VITE_AGENT_API_URL as string | undefined) ?? 'http://localhost:8000'; if (ev.origin !== agentOrigin) return
      const { type, data = {} } = ev.data ?? {}
      if (type === 'INSTAGRAM_CONNECTED') {
        try { localStorage.setItem('ig_connection', JSON.stringify(data)) } catch {}
        setIgLocal(data)
        setChannelState('instagram', 'success')
        setBanner({ type: 'success', message: `Instagram connected${data.handle ? ` as ${data.handle}` : ''}` })
        router.invalidate()
      } else if (type === 'LINKEDIN_CONNECTED') {
        try { localStorage.setItem('linkedin_connection', JSON.stringify(data)) } catch {}
        setLiLocal(data)
        setLinkedinState('connected')
        setChannelState('linkedin', 'success')
        router.invalidate()
        // Fetch profile_url then open it; fallback to success banner
        getLinkedInProfile().then((res) => {
          const url = res.profile?.profile_url ?? null
          setLinkedinProfileUrl(url)
          window.open(url ?? LINKEDIN_PROFILE_FALLBACK, '_blank', 'noopener,noreferrer')
        }).catch(() => {
          window.open(LINKEDIN_PROFILE_FALLBACK, '_blank', 'noopener,noreferrer')
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Full-page OAuth redirect back — ?connected=linkedin → go to details page
  useEffect(() => {
    if (connected === 'instagram') {
      setChannelState('instagram', 'success')
      try {
        const raw = localStorage.getItem('ig_connection')
        if (raw) setIgLocal(JSON.parse(raw))
      } catch {}
      const handle = igLocal?.handle ?? ''
      setBanner({ type: 'success', message: `Instagram connected${handle ? ` as ${handle}` : ''} successfully!` })
      window.history.replaceState({}, '', window.location.pathname)
      router.invalidate()
    } else if (connected === 'linkedin') {
      try {
        const raw = localStorage.getItem('linkedin_connection')
        if (raw) setLiLocal(JSON.parse(raw))
      } catch {}
      window.history.replaceState({}, '', window.location.pathname)
      setLinkedinState('connected')
      router.invalidate()
      // Fetch profile_url (may be lazily resolved by backend) then open it
      getLinkedInProfile().then((res) => {
        const url = res.profile?.profile_url ?? null
        setLinkedinProfileUrl(url)
        window.open(url ?? LINKEDIN_PROFILE_FALLBACK, '_blank', 'noopener,noreferrer')
      }).catch(() => {
        window.open(LINKEDIN_PROFILE_FALLBACK, '_blank', 'noopener,noreferrer')
      })
    } else if (errorParam) {
      const isLinkedIn = errorParam.startsWith('linkedin_')
      setChannelState(isLinkedIn ? 'linkedin' : 'instagram', 'error')
      const human = ERROR_MESSAGES[errorParam] ?? `Connection failed: ${errorParam.replace(/_/g, ' ')}`
      setBanner({ type: 'error', message: human })
      window.history.replaceState({}, '', window.location.pathname)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, errorParam])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 8000)
    return () => clearTimeout(t)
  }, [banner])

  const handleConnect = async (channel: string) => {
    if (channel === 'linkedin') { await checkLinkedInThenAct(); return }
    if (channel !== 'instagram') {
      alert(`${CHANNEL_META[channel]?.label ?? channel} connection coming soon.`)
      return
    }
    setChannelState(channel, 'connecting')
    setBusy(`${channel}-connect`)
    try {
      const url = await (await import('#/lib/marketing')).getInstagramConnectUrl()
      window.location.href = url
    } catch {
      setChannelState(channel, 'error')
      setBanner({ type: 'error', message: 'Failed to start connection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

  const handleDisconnect = async (channel: string) => {
    setBusy(`${channel}-disconnect`)
    try {
      if (channel === 'linkedin') {
        await disconnectLinkedIn()
        try { localStorage.removeItem('linkedin_connection') } catch {}
        setLiLocal(null)
        setLinkedinState('not_connected')
      } else {
        await disconnectInstagram({ data: { channel_id: channel } })
        if (channel === 'instagram') {
          try { localStorage.removeItem('ig_connection') } catch {}
          setIgLocal(null)
        }
      }
      await router.invalidate()
      setBanner({ type: 'success', message: `${CHANNEL_META[channel]?.label ?? channel} disconnected.` })
    } catch {
      setBanner({ type: 'error', message: 'Failed to disconnect channel.' })
    } finally {
      setBusy(null)
    }
  }

  const handleSync = async (channel: string) => {
    setBusy(`${channel}-sync`)
    try {
      await syncChannelConnection({ data: { channel } })
      await router.invalidate()
      setBanner({ type: 'success', message: 'Sync completed.' })
    } catch {
      setBanner({ type: 'error', message: 'Sync failed.' })
    } finally {
      setBusy(null)
    }
  }

  // "Sync Now" header action — syncs every currently-connected channel in turn,
  // reusing the same server fn as the per-card Sync button.
  const handleSyncAll = async () => {
    setBusy('sync-all')
    try {
      const targets = connectedChannels.map((c) => c.channel)
      for (const channel of targets) {
        await syncChannelConnection({ data: { channel } })
      }
      await router.invalidate()
      setBanner({
        type: 'success',
        message: targets.length ? 'All channels synced.' : 'No connected channels to sync.',
      })
    } catch {
      setBanner({ type: 'error', message: 'Sync failed.' })
    } finally {
      setBusy(null)
    }
  }

  // Whether a channel counts as connected for grouping. Mirrors the per-card
  // logic below (reconnect-required LinkedIn is treated as not-yet-connected).
  const channelIsConnected = (ch: ChannelConnection): boolean => {
    const isLinkedIn = ch.channel === 'linkedin'
    const liReconnect = isLinkedIn && linkedinState === 'reconnect_required'
    const localConnected =
      (ch.channel === 'instagram' && igLocal != null) ||
      (isLinkedIn && liLocal != null)
    return (ch.status === 'connected' || localConnected) && !liReconnect
  }

  const knownChannels = channels.filter((c: ChannelConnection) => CHANNEL_META[c.channel])
  const connectedChannels = knownChannels.filter(channelIsConnected)
  const availableToConnect = knownChannels.filter((c) => !channelIsConnected(c))

  // One card renderer, reused by the connected list and the connect-more list.
  const renderChannelCard = (ch: ChannelConnection) => {
    const meta = CHANNEL_META[ch.channel]
    if (!meta) return null
    const isLinkedIn = ch.channel === 'linkedin'
    const liReconnect = isLinkedIn && linkedinState === 'reconnect_required'
    const localConnected =
      (ch.channel === 'instagram' && igLocal != null) ||
      (isLinkedIn && liLocal != null)
    const isConnected = (ch.status === 'connected' || localConnected) && !liReconnect
    const displayHandle =
      ch.handle ??
      (ch.channel === 'instagram' ? igLocal?.handle : null) ??
      (isLinkedIn ? liLocal?.handle : null)

    const accent = liReconnect ? 'before:bg-amber-500' : 'before:bg-emerald-500'

    return (
      <div
        key={ch.channel}
        className={`group relative overflow-hidden rounded-[20px] border bg-card p-5 shadow-card transition hover:shadow-float ${
          isConnected
            ? `border-border before:absolute before:inset-y-4 before:left-0 before:w-[3px] before:rounded-full ${accent}`
            : 'border-dashed border-border'
        }`}
      >
        <div className="flex items-center gap-4">
          <ChannelIcon channel={ch.channel} />

          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-bold tracking-tight text-foreground">{meta.label}</h3>
              {liReconnect ? (
                <Badge tone="amber">
                  <AlertTriangle className="h-3 w-3" />
                  Reconnect required
                </Badge>
              ) : isConnected ? (
                <Badge tone="emerald">
                  <CheckCircle2 className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <XCircle className="h-3 w-3" />
                  Not connected
                </Badge>
              )}
            </div>
            <p className="text-[12.5px] text-muted-foreground">{meta.description}</p>
            {isConnected && (ch.account_name || displayHandle) && (
              <p className="mt-1.5 text-[12px] font-semibold text-foreground">
                {ch.account_name ?? displayHandle}
              </p>
            )}
            {isConnected && ch.account_id && (
              <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                ID: {ch.account_id}
              </p>
            )}
            {isConnected && ch.last_sync && (
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                Last sync: {formatIN(ch.last_sync)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isConnected ? (
              <>
                {!isLinkedIn && (
                  <Button
                    variant="outline"
                    className="h-9 px-3 text-[12.5px]"
                    disabled={busy !== null}
                    onClick={() => handleSync(ch.channel)}
                  >
                    {busy === `${ch.channel}-sync` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Sync
                  </Button>
                )}
                {isLinkedIn && (
                  <>
                    {/* Open the actual LinkedIn profile in a new tab */}
                    <Button
                      className="h-9 px-3 text-[12.5px] text-white hover:opacity-90"
                      style={{ background: '#0A66C2' }}
                      disabled={busy !== null || checkingLinkedIn}
                      onClick={() =>
                        window.open(
                          linkedinProfileUrl ?? LINKEDIN_PROFILE_FALLBACK,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                      title={linkedinProfileUrl ?? LINKEDIN_PROFILE_FALLBACK}
                    >
                      {checkingLinkedIn ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      Open LinkedIn
                    </Button>
                    {/* Navigate to internal details / manage page */}
                    <Button
                      variant="outline"
                      className="h-9 px-3 text-[12.5px]"
                      disabled={busy !== null}
                      onClick={goToLinkedInDetails}
                    >
                      Manage
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  className="h-9 border-rose-200 bg-rose-50 px-3 text-[12.5px] text-rose-700 hover:bg-rose-100"
                  disabled={busy !== null}
                  onClick={() => handleDisconnect(ch.channel)}
                >
                  {busy === `${ch.channel}-disconnect` && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Disconnect
                </Button>
                <ChevronRight className="ml-0.5 h-4 w-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              </>
            ) : (
              (() => {
                const cs = connectState[ch.channel] ?? 'idle'
                const isConnecting = cs === 'connecting'
                const hasError = cs === 'error'
                const isChecking = isLinkedIn && checkingLinkedIn
                const reconnect = liReconnect
                return (
                  <Button
                    className="h-9 px-4 text-[12.5px] text-white hover:opacity-90"
                    style={{ background: hasError ? '#dc2626' : reconnect ? '#b45309' : meta.color }}
                    disabled={busy !== null || isChecking}
                    onClick={() => (reconnect ? startLinkedInOAuth() : handleConnect(ch.channel))}
                  >
                    {isChecking ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</>
                    ) : isConnecting ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</>
                    ) : reconnect ? (
                      <><RotateCw className="h-3.5 w-3.5" />Reconnect</>
                    ) : hasError ? 'Retry' : (
                      `Connect ${meta.label}`
                    )}
                  </Button>
                )
              })()
            )}
          </div>
        </div>
      </div>
    )
  }

  const lastSyncIso =
    channels.find((c: ChannelConnection) => c.status === 'connected')?.last_sync ?? null

  const stats = [
    {
      label: 'Total Channels',
      value: String(knownChannels.length),
      sub: 'All available channels',
      icon: Network,
      tint: 'text-[var(--brand)]',
      chip: 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)]',
    },
    {
      label: 'Connected',
      value: String(connectedChannels.length),
      sub: 'Active connections',
      icon: CheckCircle2,
      tint: 'text-emerald-600',
      chip: 'bg-emerald-50',
    },
    {
      label: 'Disconnected',
      value: String(availableToConnect.length),
      sub: 'Not connected',
      icon: AlertCircle,
      tint: 'text-amber-600',
      chip: 'bg-amber-50',
    },
    {
      label: 'Last Sync',
      value: lastSyncIso ? formatIN(lastSyncIso).split(',')[0] : '—',
      sub: lastSyncIso ? formatINTime(lastSyncIso) : 'No sync yet',
      icon: Calendar,
      tint: 'text-sky-600',
      chip: 'bg-sky-50',
    },
  ]

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 md:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-foreground">Connected Channels</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Manage your social media and publishing channel integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={handleSyncAll} disabled={busy !== null}>
            {busy === 'sync-all' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Now
          </Button>
          <details className="relative">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-card text-foreground transition hover:bg-muted [&::-webkit-details-marker]:hidden">
              <MoreHorizontal className="h-4 w-4" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-[12px] border border-border bg-card py-1 shadow-float">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                onClick={() => router.invalidate()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh status
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                onClick={handleSyncAll}
              >
                <RotateCw className="h-3.5 w-3.5" /> Sync all channels
              </button>
            </div>
          </details>
        </div>
      </div>

      {banner && (
        <div
          className={`flex items-center gap-3 rounded-[14px] border px-4 py-3 text-[13px] font-medium shadow-card ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {banner.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{banner.message}</span>
          <button
            aria-label="Dismiss"
            onClick={() => setBanner(null)}
            className="rounded-md p-0.5 opacity-60 transition hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <div
              key={s.label}
              className="rounded-[18px] border border-border bg-card p-5 shadow-card transition hover:shadow-float"
            >
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full ${s.chip}`}>
                <Icon className={`h-5 w-5 ${s.tint}`} strokeWidth={2.2} />
              </div>
              <p className="kicker text-muted-foreground/70">{s.label}</p>
              <p className="num mt-1 text-[28px] font-bold leading-none text-foreground">{s.value}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">{s.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Connected channels — only those actually linked are shown here */}
      {connectedChannels.length === 0 ? (
        <div className="rounded-[20px] border-2 border-dashed border-border bg-[color-mix(in_oklab,var(--brand)_4%,transparent)] px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand)_12%,transparent)]">
            <Link2 className="h-5 w-5 text-[var(--brand)]" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">No channels connected yet</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Connect a channel below to start publishing.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="kicker text-muted-foreground/70">Your Connected Channels</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {connectedChannels.length}
            </span>
          </div>
          <div className="space-y-3">{connectedChannels.map(renderChannelCard)}</div>
        </div>
      )}

      {/* Connect-more — the OAuth entry point for not-yet-connected channels */}
      {availableToConnect.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="kicker text-muted-foreground/70">
              {connectedChannels.length === 0 ? 'Available Channels' : 'Connect More Channels'}
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {availableToConnect.length}
            </span>
          </div>
          <div className="space-y-3">{availableToConnect.map(renderChannelCard)}</div>
        </div>
      )}

      {/* Security banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50">
            <Lock className="h-5 w-5 text-emerald-600" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-foreground">Your connections are secure</p>
            <p className="text-[12.5px] text-muted-foreground">
              We use industry-standard encryption to keep your data safe and private.
            </p>
          </div>
        </div>
        <a
          href="https://help.dealerintelligence.os/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--brand)] transition hover:opacity-80"
        >
          Learn More
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Secondary note — why Instagram routes through Meta/Facebook */}
      <details className="rounded-[14px] border border-border bg-muted/30 p-4">
        <summary className="cursor-pointer list-none text-[12px] font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
          Why Facebook login for Instagram?
        </summary>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          Instagram removed its own OAuth in 2020. Authentication now goes through Meta (Facebook):
          you log in with Facebook, authorize your Facebook Page, and the Instagram Business Account
          linked to that Page is automatically connected. Your Instagram account must be a{' '}
          <strong>Business or Creator account</strong> linked to a Facebook Page via Meta Business Suite.
          Set{' '}
          <code className="rounded bg-muted px-1 font-mono text-[10px]">FACEBOOK_APP_ID</code> and{' '}
          <code className="rounded bg-muted px-1 font-mono text-[10px]">FACEBOOK_APP_SECRET</code> in{' '}
          <code className="rounded bg-muted px-1 font-mono text-[10px]">apps/api/.env</code>.
          Facebook, Google Business, and WhatsApp coming soon.
        </p>
      </details>
    </div>
  )
}
