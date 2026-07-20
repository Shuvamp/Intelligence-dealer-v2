import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
  getChannelStatus,
  getLinkedInProfile,
  disconnectInstagram,
  disconnectLinkedIn,
  syncChannelConnection,
  getYouTubeStatus,
  disconnectYouTube,
  disconnectFacebook,
  connectWhatsApp,
  disconnectWhatsApp,
} from '#/lib/marketing'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import type { ChannelConnection, LinkedInState } from '#/lib/types'
import {
  CheckCircle2, RefreshCw, ExternalLink, Loader2, AlertCircle,
  AlertTriangle, RotateCw, Link2, Network, MoreHorizontal, X, Search, Plus,
} from 'lucide-react'
import { ChannelIcon } from '#/components/marketing/ChannelIcon'
import { Button, formatIN, formatINTime } from '#/components/ui/kit'

export const Route = createFileRoute('/_authed/channels')({
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
  x:               { label: 'X (Twitter)',         color: '#000000', bg: '#F4F4F5', description: 'Post updates and threads to your X (formerly Twitter) profile.' },
  youtube:         { label: 'YouTube',             color: '#FF0000', bg: '#FEF2F2', description: 'Publish video updates and community posts to your channel.' },
  telegram:        { label: 'Telegram',            color: '#229ED9', bg: '#EFF9FF', description: 'Broadcast campaign messages to your Telegram channel.' },
  threads:         { label: 'Threads',             color: '#000000', bg: '#F4F4F5', description: 'Share posts and updates to your Threads profile.' },
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
  youtube_access_denied:    'You cancelled the YouTube authorization. Click Connect to try again.',
  youtube_no_channel:       'No YouTube channel found on this Google account.',
  youtube_callback_failed:  'An unexpected error occurred during YouTube connection. Check the API server logs.',
  facebook_access_denied:          'You cancelled the Facebook authorization. Click Connect to try again.',
  facebook_no_pages:               'No Facebook Pages found on your account. Create a Facebook Page and try again.',
  facebook_redirect_uri_mismatch:  'OAuth redirect URI mismatch — check FACEBOOK_PAGE_REDIRECT_URI in apps/api/.env matches your Meta app settings.',
  facebook_invalid_code:           'Authorization code expired or already used. Please start the connection again.',
  facebook_meta_api_error:         'Meta API returned an error. Check the API server logs.',
  facebook_callback_failed:        'An unexpected error occurred during Facebook connection. Check the API server logs.',
  facebook_no_page_token:          'Facebook did not return a page-level access token. Make sure pages_show_list is granted, then reconnect.',
  facebook_missing_permissions:    'Your Facebook Page token is missing publish permissions (pages_manage_posts / pages_read_engagement). Add them to the Facebook Login for Business Configuration in Meta Developer Console, then reconnect.',
}

type ConnectState = 'idle' | 'connecting' | 'success' | 'error'

function ConnectedChannels() {
  const { channels } = Route.useLoaderData()
  const { connected, error: errorParam } = Route.useSearch()
  const router = useRouter()

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [connectState, setConnectState] = useState<Record<string, ConnectState>>({})

  // WhatsApp manual-credential connect modal (no OAuth).
  const [waModalOpen, setWaModalOpen] = useState(false)
  const [waForm, setWaForm] = useState({ phone_number_id: '', access_token: '', display_name: '' })
  const [waSubmitting, setWaSubmitting] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)

  const setChannelState = (ch: string, s: ConnectState) =>
    setConnectState(prev => ({ ...prev, [ch]: s }))

  // View controls (client-side only — no effect on connection state or APIs)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'connected'>('connected')
  const [sort, setSort] = useState<'az' | 'recent'>('az')

  const [igLocal, setIgLocal] = useState<{ handle?: string; instagram_business_account_id?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('ig_connection') ?? 'null') } catch { return null }
  })

  const [liLocal, setLiLocal] = useState<{ handle?: string; linkedin_id?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('linkedin_connection') ?? 'null') } catch { return null }
  })

  const [ytLocal, setYtLocal] = useState<{ handle?: string; youtube_channel_id?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('youtube_connection') ?? 'null') } catch { return null }
  })

  const [fbLocal, setFbLocal] = useState<{ handle?: string; page_id?: string; page_name?: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem('facebook_connection') ?? 'null') } catch { return null }
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

  const goToYouTubeDetails = () =>
    router.navigate({ to: '/marketing/youtube-channel' })

  const startYouTubeOAuth = async () => {
    setChannelState('youtube', 'connecting')
    setBusy('youtube-connect')
    try {
      const { getYouTubeConnectUrl } = await import('#/lib/marketing')
      const url = await getYouTubeConnectUrl()
      window.location.href = url
    } catch {
      setChannelState('youtube', 'error')
      setBanner({ type: 'error', message: 'Failed to start connection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

  const startFacebookOAuth = async () => {
    setChannelState('facebook', 'connecting')
    setBusy('facebook-connect')
    try {
      const { getFacebookConnectUrl } = await import('#/lib/marketing')
      const url = await getFacebookConnectUrl()
      window.location.href = url
    } catch {
      setChannelState('facebook', 'error')
      setBanner({ type: 'error', message: 'Failed to start connection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

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
      } else if (type === 'YOUTUBE_CONNECTED') {
        try { localStorage.setItem('youtube_connection', JSON.stringify(data)) } catch {}
        setYtLocal(data)
        setChannelState('youtube', 'success')
        setBanner({ type: 'success', message: `YouTube connected${data.handle ? ` as ${data.handle}` : ''}` })
        router.invalidate()
      } else if (type === 'FACEBOOK_CONNECTED') {
        try { localStorage.setItem('facebook_connection', JSON.stringify(data)) } catch {}
        setFbLocal(data)
        setChannelState('facebook', 'success')
        setBanner({ type: 'success', message: `Facebook connected${data.page_name ? ` — ${data.page_name}` : ''}` })
        router.invalidate()
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
    } else if (connected === 'youtube') {
      try {
        const raw = localStorage.getItem('youtube_connection')
        if (raw) setYtLocal(JSON.parse(raw))
      } catch {}
      window.history.replaceState({}, '', window.location.pathname)
      router.invalidate()
      setBanner({ type: 'success', message: 'YouTube connected successfully!' })
    } else if (connected === 'facebook') {
      try {
        const raw = localStorage.getItem('facebook_connection')
        if (raw) setFbLocal(JSON.parse(raw))
      } catch {}
      window.history.replaceState({}, '', window.location.pathname)
      router.invalidate()
      setBanner({ type: 'success', message: 'Facebook connected successfully!' })
    } else if (errorParam) {
      const isLinkedIn = errorParam.startsWith('linkedin_')
      const isYouTube = errorParam.startsWith('youtube_')
      const isFacebook = errorParam.startsWith('facebook_')
      setChannelState(isLinkedIn ? 'linkedin' : isYouTube ? 'youtube' : isFacebook ? 'facebook' : 'instagram', 'error')
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

  const submitWhatsApp = async () => {
    setWaSubmitting(true)
    setWaError(null)
    try {
      const res = await connectWhatsApp({ data: {
        phone_number_id: waForm.phone_number_id.trim(),
        access_token: waForm.access_token.trim(),
        display_name: waForm.display_name.trim() || undefined,
      } })
      setChannelState('whatsapp', 'success')
      setBanner({ type: 'success', message: `WhatsApp connected${res.handle ? ` — ${res.handle}` : ''}` })
      setWaModalOpen(false)
      setWaForm({ phone_number_id: '', access_token: '', display_name: '' })
      await router.invalidate()
    } catch (e) {
      setWaError(e instanceof Error ? e.message : 'Connection failed. Check your credentials.')
    } finally {
      setWaSubmitting(false)
    }
  }

  const handleConnect = async (channel: string) => {
    if (channel === 'linkedin') { await checkLinkedInThenAct(); return }
    if (channel === 'youtube') { await startYouTubeOAuth(); return }
    if (channel === 'facebook') { await startFacebookOAuth(); return }
    if (channel === 'whatsapp') { setWaError(null); setWaModalOpen(true); return }
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
      } else if (channel === 'youtube') {
        await disconnectYouTube()
        try { localStorage.removeItem('youtube_connection') } catch {}
        setYtLocal(null)
      } else if (channel === 'facebook') {
        await disconnectFacebook()
        try { localStorage.removeItem('facebook_connection') } catch {}
        setFbLocal(null)
      } else if (channel === 'whatsapp') {
        await disconnectWhatsApp()
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
    // No /api/facebook/sync yet — and the generic instagram-sync endpoint is
    // hardcoded to the "instagram" row, so routing facebook through it would
    // silently touch the wrong channel. Guard here too (not just the button).
    if (channel === 'facebook' || channel === 'whatsapp') return
    setBusy(`${channel}-sync`)
    try {
      if (channel === 'youtube') {
        await getYouTubeStatus()
      } else {
        await syncChannelConnection({ data: { channel } })
      }
      await router.invalidate()
      setBanner({ type: 'success', message: 'Sync completed.' })
    } catch {
      setBanner({ type: 'error', message: 'Sync failed.' })
    } finally {
      setBusy(null)
    }
  }

  // "Sync all" toolbar action — syncs every currently-connected channel in turn,
  // reusing the same server fn as the per-card Sync action.
  const handleSyncAll = async () => {
    setBusy('sync-all')
    try {
      const targets = connectedChannels.map((c) => c.channel).filter((c) => c !== 'facebook' && c !== 'whatsapp')
      for (const channel of targets) {
        if (channel === 'youtube') {
          await getYouTubeStatus()
        } else {
          await syncChannelConnection({ data: { channel } })
        }
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
      (isLinkedIn && liLocal != null) ||
      (ch.channel === 'youtube' && ytLocal != null) ||
      (ch.channel === 'facebook' && fbLocal != null)
    return (ch.status === 'connected' || localConnected) && !liReconnect
  }

  // Show every channel we have metadata for. Use the backend record when present,
  // otherwise synthesize a disconnected entry so newly-added connectors still list.
  const byChannel = new Map(channels.map((c: ChannelConnection) => [c.channel, c]))
  const knownChannels: Array<ChannelConnection> = Object.keys(CHANNEL_META).map(
    (key) => byChannel.get(key) ?? { channel: key, status: 'disconnected', handle: null, last_sync: null },
  )
  const connectedChannels = knownChannels.filter(channelIsConnected)
  const availableToConnect = knownChannels.filter((c) => !channelIsConnected(c))

  // One premium card per channel — rendered in a single unified grid.
  const renderChannelCard = (ch: ChannelConnection) => {
    const meta = CHANNEL_META[ch.channel]
    if (!meta) return null
    const isLinkedIn = ch.channel === 'linkedin'
    const isYouTube = ch.channel === 'youtube'
    const isFacebook = ch.channel === 'facebook'
    const isInstagram = ch.channel === 'instagram'
    const liReconnect = isLinkedIn && linkedinState === 'reconnect_required'
    const localConnected =
      (ch.channel === 'instagram' && igLocal != null) ||
      (isLinkedIn && liLocal != null) ||
      (isYouTube && ytLocal != null) ||
      (isFacebook && fbLocal != null)
    const isConnected = (ch.status === 'connected' || localConnected) && !liReconnect
    const displayHandle =
      ch.handle ??
      (ch.channel === 'instagram' ? igLocal?.handle : null) ??
      (isLinkedIn ? liLocal?.handle : null) ??
      (isYouTube ? ytLocal?.handle : null) ??
      (isFacebook ? fbLocal?.handle : null)

    const cs = connectState[ch.channel] ?? 'idle'
    const isConnecting = cs === 'connecting'
    const hasError = cs === 'error'
    const isChecking = isLinkedIn && checkingLinkedIn

    return (
      <article
        key={ch.channel}
        className="group flex flex-col rounded-[20px] border border-border/70 bg-card p-6 shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-float"
      >
        {/* Top: identity + overflow menu */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <ChannelIcon channel={ch.channel} />
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-tight text-foreground">{meta.label}</h3>
              <div className="mt-1">
                {liReconnect ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> Reconnect required
                  </span>
                ) : isConnected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> Not connected
                  </span>
                )}
              </div>
            </div>
          </div>

          {isConnected ? (
            <details className="relative shrink-0">
              <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground/70 transition hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
                <MoreHorizontal className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 z-20 mt-1.5 w-52 overflow-hidden rounded-[12px] border border-border bg-card py-1 shadow-float">
                {!isLinkedIn && !isYouTube && !isFacebook && ch.channel !== 'whatsapp' && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() => handleSync(ch.channel)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Sync now
                  </button>
                )}
                {isLinkedIn && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                    onClick={goToLinkedInDetails}
                  >
                    <Network className="h-3.5 w-3.5" /> Manage connection
                  </button>
                )}
                {isYouTube && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                    onClick={goToYouTubeDetails}
                  >
                    <Network className="h-3.5 w-3.5" /> Manage connection
                  </button>
                )}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted"
                  onClick={() => router.invalidate()}
                >
                  <RotateCw className="h-3.5 w-3.5" /> Refresh status
                </button>
              </div>
            </details>
          ) : (
            // Not connected — a single "+" add button triggers the connect flow.
            <button
              type="button"
              aria-label={liReconnect ? `Reconnect ${meta.label}` : `Connect ${meta.label}`}
              title={liReconnect ? 'Reconnect' : `Connect ${meta.label}`}
              disabled={busy !== null || isChecking}
              onClick={() => (liReconnect ? startLinkedInOAuth() : handleConnect(ch.channel))}
              style={hasError ? { color: '#dc2626', borderColor: '#fecaca' } : liReconnect ? { color: '#b45309', borderColor: '#fcd34d' } : undefined}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isChecking || isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : liReconnect ? (
                <RotateCw className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* Middle: description + connected account meta (connected cards only) */}
        {isConnected && (
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{meta.description}</p>
        )}
        {isConnected && (ch.account_name || displayHandle) && (
          <p className="mt-3 text-[13px] font-semibold text-foreground">{ch.account_name ?? displayHandle}</p>
        )}
        {isConnected && ch.account_id && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">ID: {ch.account_id}</p>
        )}
        {isConnected && ch.last_sync && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">Last synced {formatIN(ch.last_sync)}</p>
        )}

        {/* Bottom: actions (connected channels only) */}
        {isConnected && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            {isLinkedIn && (
                <>
                  {/* Open the actual LinkedIn profile in a new tab */}
                  <Button
                    variant="primary"
                    className="h-9 px-3.5 text-[12.5px]"
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
                    Open
                  </Button>
                  {/* Navigate to internal details / manage page */}
                  <Button
                    variant="outline"
                    className="h-9 px-3.5 text-[12.5px]"
                    disabled={busy !== null}
                    onClick={goToLinkedInDetails}
                  >
                    Manage
                  </Button>
                </>
              )}
              {isYouTube && (
                <Button
                  variant="outline"
                  className="h-9 px-3.5 text-[12.5px]"
                  disabled={busy !== null}
                  onClick={goToYouTubeDetails}
                >
                  Manage
                </Button>
              )}
              {isFacebook && (
                <Button
                  variant="primary"
                  className="h-9 px-3.5 text-[12.5px]"
                  disabled={busy !== null}
                  onClick={() =>
                    window.open(
                      `https://www.facebook.com/${ch.account_id ?? fbLocal?.page_id ?? ''}`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              )}
              {isInstagram && (
                <Button
                  variant="primary"
                  className="h-9 px-3.5 text-[12.5px]"
                  disabled={busy !== null}
                  onClick={() =>
                    window.open(
                      `https://www.instagram.com/${(displayHandle ?? '').replace(/^@/, '')}/`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              )}
              {!isLinkedIn && !isYouTube && !isFacebook && !isInstagram && ch.channel !== 'whatsapp' && (
                <Button
                  variant="outline"
                  className="h-9 px-3.5 text-[12.5px]"
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
              <Button
                variant="outline"
                className="h-9 border-rose-200 px-3.5 text-[12.5px] text-rose-600 hover:bg-rose-50"
                disabled={busy !== null}
                onClick={() => handleDisconnect(ch.channel)}
              >
                {busy === `${ch.channel}-disconnect` && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Disconnect
              </Button>
          </div>
        )}
      </article>
    )
  }

  const lastSyncIso =
    channels.find((c: ChannelConnection) => c.status === 'connected')?.last_sync ?? null

  const summary = [
    { label: 'Total', value: knownChannels.length, dot: 'bg-foreground/40' },
    { label: 'Connected', value: connectedChannels.length, dot: 'bg-emerald-500' },
    { label: 'Not Connected', value: availableToConnect.length, dot: 'bg-muted-foreground/40' },
  ]

  // Search + filter + sort are pure view transforms over the same channel list.
  const q = query.trim().toLowerCase()
  const visibleChannels = knownChannels
    .filter((ch) => !q || CHANNEL_META[ch.channel].label.toLowerCase().includes(q))
    .filter((ch) => (filter === 'connected' ? channelIsConnected(ch) : !channelIsConnected(ch)))
    .slice()
    .sort((a, b) => {
      if (sort === 'az') {
        return CHANNEL_META[a.channel].label.localeCompare(CHANNEL_META[b.channel].label)
      }
      // "Recently connected" — most-recent last_sync first, unsynced last.
      const at = a.last_sync ? new Date(a.last_sync).getTime() : 0
      const bt = b.last_sync ? new Date(b.last_sync).getTime() : 0
      return bt - at
    })

  const selectCls =
    'h-10 cursor-pointer rounded-[12px] border border-border bg-card px-3 pr-8 text-[13px] font-medium text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/25'

  return (
    <div className="min-h-full" style={{ background: '#FAFAFC' }}>
      <div className="mx-auto max-w-[1080px] px-6 py-10 md:px-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight text-foreground">Channels</h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Connect your social media platforms to publish and manage content.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-[12px]"
            onClick={handleSyncAll}
            disabled={busy !== null}
          >
            {busy === 'sync-all' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync all
          </Button>
        </div>

        {/* Summary chips */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {summary.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${s.dot}`} />
              <span className="font-medium text-foreground">{s.label}</span>
              <span className="num font-semibold text-foreground">{s.value}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            <span className="font-medium text-foreground">Last Sync</span>
            <span className="text-muted-foreground">
              • {lastSyncIso ? `${formatIN(lastSyncIso).split(',')[0]} ${formatINTime(lastSyncIso)}` : 'No sync yet'}
            </span>
          </span>
        </div>

        {banner && (
          <div
            className={`mt-6 flex items-center gap-3 rounded-[14px] border px-4 py-3 text-[13px] font-medium shadow-card ${
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

        {/* Tabs + search + sort */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Channel view"
            className="inline-flex items-center gap-1 rounded-[12px] border border-border bg-card p-1"
          >
            {([
              { key: 'connected', label: 'Connected', count: connectedChannels.length },
              { key: 'all', label: 'All Channels', count: availableToConnect.length },
            ] as const).map((t) => {
              const active = filter === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(t.key)}
                  className={`inline-flex items-center gap-2 rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold transition duration-200 ${
                    active
                      ? 'bg-muted text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  <span
                    className={`num rounded-full px-1.5 text-[11px] font-semibold ${
                      active ? 'bg-background text-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <div className="relative min-w-[200px] max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search channels…"
                aria-label="Search channels"
                className="h-10 w-full rounded-[12px] border border-border bg-card pl-9 pr-3 text-[13px] text-foreground transition placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'az' | 'recent')}
              aria-label="Sort channels"
              className={selectCls}
            >
              <option value="az">A–Z</option>
              <option value="recent">Recently Connected</option>
            </select>
          </div>
        </div>

        {/* Channel grid */}
        {visibleChannels.length === 0 ? (
          <div className="mt-6 rounded-[20px] border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Link2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-[15px] font-semibold text-foreground">No channels match</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            {visibleChannels.map(renderChannelCard)}
          </div>
        )}
      </div>

      {/* WhatsApp manual-credential connect modal */}
      <Dialog open={waModalOpen} onOpenChange={(v) => { if (!v && !waSubmitting) setWaModalOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ChannelIcon channel="whatsapp" /> Connect WhatsApp Business
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              WhatsApp Cloud API has no login popup. Paste your <strong>Phone Number ID</strong> and a
              permanent <strong>Access Token</strong> from Meta → WhatsApp → API Setup.
            </p>
            <label className="block">
              <span className="text-[12px] font-semibold text-foreground">Phone Number ID</span>
              <input
                type="text"
                value={waForm.phone_number_id}
                onChange={(e) => setWaForm((f) => ({ ...f, phone_number_id: e.target.value }))}
                placeholder="e.g. 123456789012345"
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-foreground">Access Token</span>
              <input
                type="password"
                value={waForm.access_token}
                onChange={(e) => setWaForm((f) => ({ ...f, access_token: e.target.value }))}
                placeholder="Permanent token (EAAG…)"
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-foreground">Display name <span className="font-normal text-muted-foreground">(optional)</span></span>
              <input
                type="text"
                value={waForm.display_name}
                onChange={(e) => setWaForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Overrides Meta's verified name"
                className="mt-1 h-10 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/25"
              />
            </label>
            {waError && (
              <div className="flex items-start gap-2 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{waError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="h-9 px-3.5 text-[12.5px]" disabled={waSubmitting} onClick={() => setWaModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-9 px-3.5 text-[12.5px]"
                disabled={waSubmitting || !waForm.phone_number_id.trim() || !waForm.access_token.trim()}
                onClick={submitWhatsApp}
              >
                {waSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
