import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  getYouTubeStatus,
  disconnectYouTube,
  getYouTubeConnectUrl,
  getCurrentTenantId,
  publishYouTubeVideo,
} from '#/lib/marketing'
import type { YouTubeStatus } from '#/lib/types'
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UploadCloud,
  Youtube,
  XCircle,
} from 'lucide-react'

export const Route = createFileRoute('/_authed/marketing/youtube-channel')({
  loader: async () => {
    const [status, tenantId] = await Promise.all([getYouTubeStatus(), getCurrentTenantId()])
    return { status, tenantId }
  },
  component: YouTubeChannelPage,
})

function YouTubeChannelPage() {
  const router = useRouter()
  const { status: initial, tenantId } = Route.useLoaderData()

  const [status, setStatus] = useState<YouTubeStatus>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [privacyStatus, setPrivacyStatus] = useState('private')
  const [publishing, setPublishing] = useState(false)
  const [lastPublished, setLastPublished] = useState<{ video_id: string; video_url: string } | null>(null)

  const back = () => router.navigate({ to: '/channels', search: {} as any })

  const handleSync = async () => {
    setBusy('sync')
    setBanner(null)
    try {
      const res = await getYouTubeStatus()
      setStatus(res)
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
      await disconnectYouTube()
      try { localStorage.removeItem('youtube_connection') } catch {}
      back()
    } catch {
      setBanner({ type: 'error', message: 'Failed to disconnect.' })
      setBusy(null)
    }
  }

  const handleReconnect = async () => {
    setBusy('reconnect')
    try {
      const url = await getYouTubeConnectUrl()
      window.location.href = url
    } catch {
      setBanner({ type: 'error', message: 'Failed to start connection. Is the API server running on :8000?' })
      setBusy(null)
    }
  }

  const handlePublish = async () => {
    if (!file || !title.trim() || !tenantId) return
    setPublishing(true)
    setBanner(null)
    setLastPublished(null)
    try {
      const res = await publishYouTubeVideo(tenantId, file, {
        title: title.trim(), description, tags, privacy_status: privacyStatus,
      })
      if (res.status === 'success' && res.video_id && res.video_url) {
        setLastPublished({ video_id: res.video_id, video_url: res.video_url })
        setBanner({ type: 'success', message: 'Video published to YouTube.' })
        setFile(null); setTitle(''); setDescription(''); setTags('')
      } else {
        setBanner({ type: 'error', message: res.error ?? 'Publish failed.' })
      }
    } catch (e) {
      setBanner({ type: 'error', message: e instanceof Error ? e.message : 'Publish failed.' })
    } finally {
      setPublishing(false)
    }
  }

  if (!status.connected) {
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
          <p className="font-semibold text-foreground">No YouTube channel connected</p>
          <p className="text-[12px] text-muted-foreground">Go back to Channels to connect your YouTube channel.</p>
          <button
            className="mt-2 rounded-[10px] px-4 py-2 text-[12px] font-semibold text-white"
            style={{ background: '#FF0000' }}
            onClick={back}
          >
            Back to Channels
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-6">
      <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <button className="hover:text-foreground transition" onClick={back}>Channels</button>
        <span>/</span>
        <span className="text-foreground font-medium">YouTube</span>
      </nav>

      <div className="flex items-center gap-4">
        <div
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[14px] text-white shadow-sm"
          style={{ background: '#FF0000', height: 52, width: 52 }}
        >
          <Youtube className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h1 className="text-[24px] font-bold text-foreground leading-none">YouTube</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Connected channel details</p>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connected
        </span>
      </div>

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

      {/* Detail rows */}
      <div className="rounded-[18px] border border-border bg-white overflow-hidden">
        {[
          { label: 'Channel Name', value: status.channel_name ?? '—' },
          { label: 'Channel ID', value: status.channel_id ?? '—', mono: true },
          {
            label: 'Last Sync',
            value: status.last_sync ? new Date(status.last_sync).toLocaleString() : '—',
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
        {status.channel_id && (
          <a
            href={`https://www.youtube.com/channel/${status.channel_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white transition"
            style={{ background: '#FF0000' }}
          >
            Open Channel
          </a>
        )}
        <button
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-[10px] border border-border px-5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
          onClick={handleSync}
        >
          {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync
        </button>
        <button
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-[10px] border border-border px-5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
          onClick={handleReconnect}
        >
          {busy === 'reconnect' && <Loader2 className="h-4 w-4 animate-spin" />}
          Reconnect
        </button>
        <button
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-5 py-2.5 text-[13px] font-semibold text-red-700 hover:bg-red-100 transition disabled:opacity-50"
          onClick={handleDisconnect}
        >
          {busy === 'disconnect' && <Loader2 className="h-4 w-4 animate-spin" />}
          Disconnect
        </button>
      </div>

      {/* Publish Video */}
      <div className="rounded-[18px] border border-border bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UploadCloud className="h-4 w-4 text-[#FF0000]" />
          <h2 className="text-[14px] font-semibold text-foreground">Publish Video</h2>
        </div>

        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[13px]"
        />
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-[10px] border border-border px-3 py-2 text-[13px]"
        />
        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-[10px] border border-border px-3 py-2 text-[13px]"
        />
        <input
          type="text"
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full rounded-[10px] border border-border px-3 py-2 text-[13px]"
        />
        <select
          value={privacyStatus}
          onChange={(e) => setPrivacyStatus(e.target.value)}
          className="rounded-[10px] border border-border px-3 py-2 text-[13px]"
        >
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>

        <button
          disabled={publishing || !file || !title.trim() || !tenantId}
          onClick={handlePublish}
          className="flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
          style={{ background: '#FF0000' }}
        >
          {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
          Publish
        </button>

        {lastPublished && (
          <p className="text-[12px] text-muted-foreground">
            Published:{' '}
            <a href={lastPublished.video_url} target="_blank" rel="noopener noreferrer" className="text-[#0A66C2] font-medium">
              {lastPublished.video_url}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
