import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getLinkedInProfile,
  disconnectLinkedIn,
  syncChannelConnection,
  getLinkedInConnectUrl,
  getLinkedInOrganizations,
  selectLinkedInOrganization,
  refreshLinkedInAnalytics,
} from '#/lib/marketing'
import type { LinkedInOrganization } from '#/lib/marketing'
import type { LinkedInProfile, LinkedInState } from '#/lib/types'
import {
  ArrowLeft,
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  RotateCw,
  XCircle,
} from 'lucide-react'

export const Route = createFileRoute('/_authed/marketing/linkedin-channel')({
  loader: async () => {
    const [profile, orgs] = await Promise.all([getLinkedInProfile(), getLinkedInOrganizations()])
    return { profile, orgs }
  },
  component: LinkedInChannelPage,
})

function LinkedInChannelPage() {
  const router = useRouter()
  const { profile: initial, orgs: initialOrgs } = Route.useLoaderData()

  const [liState, setLiState] = useState<LinkedInState>(initial.state)
  const [profile, setProfile] = useState<LinkedInProfile | null>(initial.profile)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [orgs] = useState<Array<LinkedInOrganization>>(initialOrgs.organizations)
  const [orgsStatus] = useState<string>(initialOrgs.status)
  const [selectedOrgUrn, setSelectedOrgUrn] = useState<string>(orgs[0]?.urn ?? '')

  const back = () => router.navigate({ to: '/channels', search: {} as any })

  const handleSync = async () => {
    setBusy('sync')
    setBanner(null)
    try {
      await syncChannelConnection({ data: { channel: 'linkedin' } })
      const res = await getLinkedInProfile()
      setLiState(res.state)
      if (res.profile) setProfile(res.profile)
      setBanner({ type: 'success', message: 'Sync completed.' })
    } catch {
      setBanner({ type: 'error', message: 'Sync failed. Check the API server.' })
    } finally {
      setBusy(null)
    }
  }

  const handleDisconnect = async () => {
    setBusy('disconnect')
    setBanner(null)
    try {
      await disconnectLinkedIn()
      try { localStorage.removeItem('linkedin_connection') } catch {}
      back()
    } catch {
      setBanner({ type: 'error', message: 'Failed to disconnect.' })
      setBusy(null)
    }
  }

  const handleReconnect = async () => {
    setBusy('reconnect')
    try {
      const url = await getLinkedInConnectUrl()
      window.location.href = url
    } catch {
      setBanner({ type: 'error', message: 'Failed to start reconnection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

  const handleSelectOrg = async () => {
    if (!selectedOrgUrn) return
    setBusy('select-org')
    setBanner(null)
    try {
      const org = orgs.find((o) => o.urn === selectedOrgUrn)
      await selectLinkedInOrganization({ data: { orgUrn: selectedOrgUrn, orgName: org?.name } })
      setBanner({ type: 'success', message: `Connected Company Page: ${org?.name ?? selectedOrgUrn}` })
    } catch {
      setBanner({ type: 'error', message: 'Failed to connect the Company Page.' })
    } finally {
      setBusy(null)
    }
  }

  const handleRefreshAnalytics = async () => {
    setBusy('refresh-analytics')
    setBanner(null)
    try {
      await refreshLinkedInAnalytics()
      setBanner({ type: 'success', message: 'Analytics refreshed.' })
    } catch {
      setBanner({ type: 'error', message: 'Analytics refresh failed.' })
    } finally {
      setBusy(null)
    }
  }

  if (liState === 'not_connected') {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-6">
        <button
          className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground transition"
          onClick={back}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Channels
        </button>
        <div className="rounded-[18px] border border-dashed border-border bg-white p-10 flex flex-col items-center gap-3">
          <XCircle className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold text-foreground">No LinkedIn account connected</p>
          <p className="text-[12px] text-muted-foreground">Go back to Channels to connect your LinkedIn account.</p>
          <button
            className="mt-2 rounded-[10px] px-4 py-2 text-[12px] font-semibold text-white"
            style={{ background: '#0A66C2' }}
            onClick={back}
          >
            Back to Channels
          </button>
        </div>
      </div>
    )
  }

  const statusLabel =
    liState === 'connected' ? 'Connected' :
    liState === 'reconnect_required' ? 'Reconnect Required' :
    liState === 'error' ? 'Error' : liState

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <button className="hover:text-foreground transition" onClick={back}>Channels</button>
        <span>/</span>
        <span className="text-foreground font-medium">LinkedIn</span>
      </nav>

      {/* Page header */}
      <div className="flex items-center gap-4">
        <div
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[14px] text-white text-[16px] font-black shadow-sm"
          style={{ background: '#0A66C2', height: 52, width: 52 }}
        >
          in
        </div>
        <div className="flex-1">
          <h1 className="text-[24px] font-bold text-foreground leading-none">LinkedIn</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Connected channel details</p>
        </div>
        <div>
          {liState === 'reconnect_required' ? (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              Reconnect Required
            </span>
          ) : liState === 'connected' ? (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          ) : null}
        </div>
      </div>

      {/* Banner */}
      {banner && (
        <div
          className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 text-[13px] font-medium ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.message}
        </div>
      )}

      {/* Reconnect notice */}
      {liState === 'reconnect_required' && (
        <div className="flex items-start gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Your LinkedIn token has expired or permissions were revoked.
            Click <strong>Reconnect LinkedIn</strong> below to restore publishing access.
          </span>
        </div>
      )}

      {/* Profile card */}
      <div className="rounded-[18px] border border-border bg-white p-6">
        <div className="flex items-center gap-5">
          {profile?.picture ? (
            <img
              src={profile.picture}
              alt={profile.name ?? 'Profile'}
              className="h-20 w-20 rounded-full border border-border object-cover shrink-0"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-[28px] font-bold text-muted-foreground">
              {(profile?.name ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[20px] font-bold text-foreground truncate">
              {profile?.name ?? '—'}
            </p>
            {profile?.email && (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground mt-1 truncate">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                {profile.email}
                {profile.email_verified && (
                  <BadgeCheck className="h-4 w-4 text-blue-500 shrink-0" aria-label="Verified" />
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Company Page (Organization) */}
      {liState === 'connected' && (
        <div className="rounded-[18px] border border-border bg-white p-6">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#0A66C2]" />
            <h2 className="text-[14px] font-semibold text-foreground">Company Page</h2>
          </div>
          {profile?.linkedin_id && orgs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-[10px] border border-border px-3 py-2 text-[13px]"
                value={selectedOrgUrn}
                onChange={(e) => setSelectedOrgUrn(e.target.value)}
              >
                {orgs.map((o) => (
                  <option key={o.urn} value={o.urn}>{o.name}</option>
                ))}
              </select>
              <button
                disabled={busy !== null}
                className="flex items-center gap-2 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white transition disabled:opacity-60"
                style={{ background: '#0A66C2' }}
                onClick={handleSelectOrg}
              >
                {busy === 'select-org' && <Loader2 className="h-4 w-4 animate-spin" />}
                Use this Page
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {orgsStatus === 'mdp_required'
                ? 'Connected as a personal profile. Full analytics (reach, impressions, shares, followers growth, profile views) require connecting a LinkedIn Company Page, which needs your LinkedIn Developer App to have Marketing Developer Platform access.'
                : 'No Company Page found for this account yet — connect a LinkedIn Company Page you administer to unlock full analytics.'}
            </p>
          )}
        </div>
      )}

      {/* Detail rows */}
      <div className="rounded-[18px] border border-border bg-white overflow-hidden">
        {[
          { label: 'Connection Status', value: statusLabel },
          { label: 'Member ID',         value: profile?.linkedin_id ?? '—', mono: true },
          { label: 'Display Name',      value: profile?.name ?? '—' },
          { label: 'Email',             value: profile?.email ?? '—' },
          { label: 'Profile URL',       value: profile?.profile_url ?? '—' },
          { label: 'Locale',            value: profile?.locale ?? '—' },
          {
            label: 'Last Sync',
            value: profile?.last_sync
              ? new Date(profile.last_sync).toLocaleString()
              : '—',
          },
        ].map(({ label, value, mono }, idx, arr) => (
          <div
            key={label}
            className={`flex items-center justify-between px-5 py-3.5 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}
          >
            <span className="text-[13px] text-muted-foreground">{label}</span>
            <span className={`text-[13px] font-medium text-foreground ${mono ? 'font-mono text-[12px]' : ''}`}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {profile?.profile_url && liState === 'connected' && (
          <a
            href={profile.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white transition"
            style={{ background: '#0A66C2' }}
          >
            <ExternalLink className="h-4 w-4" />
            Open LinkedIn Profile
          </a>
        )}
        {liState === 'reconnect_required' ? (
          <button
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-60"
            style={{ background: '#b45309' }}
            onClick={handleReconnect}
          >
            {busy === 'reconnect' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            Reconnect LinkedIn
          </button>
        ) : (
          <button
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-[10px] border border-border px-5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
            onClick={handleSync}
          >
            {busy === 'sync' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync
          </button>
        )}

        {liState === 'connected' && (
          <button
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-[10px] border border-border px-5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
            onClick={handleRefreshAnalytics}
          >
            {busy === 'refresh-analytics' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Analytics
          </button>
        )}

        <button
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-5 py-2.5 text-[13px] font-semibold text-red-700 hover:bg-red-100 transition disabled:opacity-50"
          onClick={handleDisconnect}
        >
          {busy === 'disconnect' && <Loader2 className="h-4 w-4 animate-spin" />}
          Disconnect
        </button>
      </div>
    </div>
  )
}
