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
  AlertTriangle, RotateCw, Link2,
} from 'lucide-react'

export const Route = createFileRoute('/_authed/marketing/connected-channels')({
  validateSearch: (search: Record<string, unknown>) => ({
    connected: (search.connected as string) ?? undefined,
    error: (search.error as string) ?? undefined,
  }),
  loader: async () => ({ channels: await getChannelStatus() }),
  component: ConnectedChannels,
})

const CHANNEL_META: Record<string, { label: string; icon: string; color: string; bg: string; description: string }> = {
  instagram:       { label: 'Instagram',          icon: 'IG', color: '#E1306C', bg: '#FDF2F8', description: 'Post to Instagram Feed, Stories, and Reels automatically.' },
  facebook:        { label: 'Facebook',            icon: 'FB', color: '#1877F2', bg: '#EFF6FF', description: 'Publish posts and updates to your Facebook Business Page.' },
  linkedin:        { label: 'LinkedIn',            icon: 'in', color: '#0A66C2', bg: '#EFF6FF', description: 'Share posts and updates to your LinkedIn Company Page.' },
  google_business: { label: 'Google Business',     icon: 'G',  color: '#34A853', bg: '#F0FDF4', description: 'Publish updates to your Google Business Profile listing.' },
  whatsapp:        { label: 'WhatsApp Business',   icon: 'WA', color: '#25D366', bg: '#F0FDF4', description: 'Send campaign messages to opted-in customers via WhatsApp.' },
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

    return (
      <div
        key={ch.channel}
        className={`rounded-[18px] border ${isConnected ? 'border-border' : 'border-dashed border-border'} bg-white p-5`}
      >
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-white text-[14px] font-black shadow-sm"
            style={{ background: meta.color }}
          >
            {meta.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-[14px] font-bold text-foreground">{meta.label}</h3>
              {liReconnect ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <AlertTriangle className="h-3 w-3" />
                  Reconnect required
                </span>
              ) : isConnected ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  <CheckCircle2 className="h-3 w-3" />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <XCircle className="h-3 w-3" />
                  Not connected
                </span>
              )}
            </div>
            <p className="text-[12px] text-muted-foreground">{meta.description}</p>
            {isConnected && (ch.account_name || displayHandle) && (
              <p className="text-[11px] font-semibold mt-1" style={{ color: meta.color }}>
                {ch.account_name ?? displayHandle}
              </p>
            )}
            {isConnected && ch.account_id && (
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                ID: {ch.account_id}
              </p>
            )}
            {isConnected && ch.last_sync && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Last sync: {new Date(ch.last_sync).toLocaleString()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isConnected ? (
              <>
                {!isLinkedIn && (
                  <button
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[12px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
                    onClick={() => handleSync(ch.channel)}
                  >
                    {busy === `${ch.channel}-sync` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Sync
                  </button>
                )}
                {isLinkedIn && (
                  <>
                    {/* Open the actual LinkedIn profile in a new tab */}
                    <button
                      disabled={busy !== null || checkingLinkedIn}
                      className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold text-white transition disabled:opacity-50"
                      style={{ background: '#0A66C2' }}
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
                    </button>
                    {/* Navigate to internal details / manage page */}
                    <button
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[12px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
                      onClick={goToLinkedInDetails}
                    >
                      Manage
                    </button>
                  </>
                )}
                <button
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700 hover:bg-red-100 transition disabled:opacity-50"
                  onClick={() => handleDisconnect(ch.channel)}
                >
                  {busy === `${ch.channel}-disconnect` && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Disconnect
                </button>
              </>
            ) : (
              (() => {
                const cs = connectState[ch.channel] ?? 'idle'
                const isConnecting = cs === 'connecting'
                const hasError = cs === 'error'
                const isChecking = isLinkedIn && checkingLinkedIn
                const reconnect = liReconnect
                return (
                  <button
                    disabled={busy !== null || isChecking}
                    className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-[12px] font-semibold text-white transition disabled:opacity-60"
                    style={{ background: hasError ? '#dc2626' : reconnect ? '#b45309' : meta.color }}
                    onClick={() => reconnect ? startLinkedInOAuth() : handleConnect(ch.channel)}
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
                  </button>
                )
              })()
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      <div>
        <h1 className="text-[28px] font-bold text-foreground">Connected Channels</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Manage social media and publishing channel integrations</p>
      </div>

      {banner && (
        <div
          className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 text-[13px] font-medium ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {banner.message}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Channels', value: String(knownChannels.length) },
          { label: 'Connected',      value: String(connectedChannels.length) },
          { label: 'Disconnected',   value: String(availableToConnect.length) },
          {
            label: 'Last Sync',
            value: channels.find((c: ChannelConnection) => c.status === 'connected')?.last_sync
              ? new Date(channels.find((c: ChannelConnection) => c.status === 'connected')!.last_sync!).toLocaleDateString()
              : '—',
          },
        ].map((s) => (
          <div key={s.label} className="rounded-[16px] border border-border bg-white p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{s.label}</p>
            <p className="mt-1 text-[26px] font-bold text-foreground leading-none">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Connected channels — only those actually linked are shown here */}
      {connectedChannels.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-border bg-muted/10 px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Link2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[14px] font-semibold text-foreground">No channels connected yet</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Connect a channel below to start publishing.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-[13px] font-bold text-foreground">Your connected channels</h2>
          {connectedChannels.map(renderChannelCard)}
        </div>
      )}

      {/* Connect-more — the OAuth entry point for not-yet-connected channels */}
      {availableToConnect.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[13px] font-bold text-foreground">
            {connectedChannels.length === 0 ? 'Available channels' : 'Connect more channels'}
          </h2>
          {availableToConnect.map(renderChannelCard)}
        </div>
      )}

      <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4">
        <p className="text-[12px] font-semibold text-amber-800 mb-1">Why Facebook login for Instagram?</p>
        <p className="text-[11px] text-amber-700">
          Instagram removed its own OAuth in 2020. Authentication now goes through Meta (Facebook):
          you log in with Facebook, authorize your Facebook Page, and the Instagram Business Account
          linked to that Page is automatically connected. Your Instagram account must be a{' '}
          <strong>Business or Creator account</strong> linked to a Facebook Page via Meta Business Suite.
          Set{' '}
          <code className="font-mono bg-amber-100 px-1 rounded text-[10px]">FACEBOOK_APP_ID</code> and{' '}
          <code className="font-mono bg-amber-100 px-1 rounded text-[10px]">FACEBOOK_APP_SECRET</code> in{' '}
          <code className="font-mono bg-amber-100 px-1 rounded text-[10px]">apps/api/.env</code>.
          Facebook, Google Business, and WhatsApp coming soon.
        </p>
      </div>
    </div>
  )
}
