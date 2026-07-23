import { useState } from 'react'
import { Heart, MessageCircle, Instagram, ChevronDown, ChevronUp, User, Reply, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import type { InstagramComment, InstagramPostInsight } from '#/lib/marketing'
import { getInstagramComments, replyToInstagramComment } from '#/lib/marketing'

const fmt = (n: number) => n.toLocaleString('en-IN')

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// One comment + its reply box + any nested replies (own from the app or
// already on Instagram) — a Meta Business Suite-style thread, inline.
function CommentRow({ comment, onReplied }: { comment: InstagramComment; onReplied: (reply: InstagramComment) => void }) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    try {
      const reply = await replyToInstagramComment({ data: { commentId: comment.id, message } })
      onReplied(reply)
      setDraft('')
      setReplying(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed — try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-[8px] bg-[#FAFAFA] px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F3E8FF] text-[#8B5CF6]">
          <User className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[11px] font-semibold text-[#1A1A1A]">@{comment.username}</p>
            <p className="shrink-0 text-[10px] text-[#9CA3AF]">{fmtWhen(comment.timestamp)}</p>
          </div>
          <p className="text-[11px] leading-snug text-[#4B5563]">{comment.text}</p>
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#8B5CF6] hover:text-[#6D28D9]"
          >
            <Reply className="h-3 w-3" /> Reply
          </button>
        </div>
      </div>

      {(comment.replies ?? []).map((r) => (
        <div key={r.id} className="ml-8 mt-1.5 flex items-start gap-2 rounded-[8px] bg-white px-2.5 py-1.5 ring-1 ring-[#F0F0F0]">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FDF2F8] text-[#E1306C]">
            <User className="h-2.5 w-2.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[10.5px] font-semibold text-[#1A1A1A]">@{r.username}</p>
              <p className="shrink-0 text-[9.5px] text-[#9CA3AF]">{fmtWhen(r.timestamp)}</p>
            </div>
            <p className="text-[10.5px] leading-snug text-[#4B5563]">{r.text}</p>
          </div>
        </div>
      ))}

      {replying && (
        <div className="ml-8 mt-1.5 flex items-start gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="Write a reply…"
            disabled={sending}
            className="min-w-0 flex-1 rounded-[8px] border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-[#8B5CF6] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || !draft.trim()}
            className="flex shrink-0 items-center justify-center rounded-[8px] bg-[#8B5CF6] p-1.5 text-white transition disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && <p className="ml-8 mt-1 text-[10px] font-medium text-red-500">{error}</p>}
    </div>
  )
}

// Individual commenter/text/date-time for one post — expands inline so the
// user never has to leave the dashboard for Instagram.
function CommentsBreakdown({ post }: { post: InstagramPostInsight }) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<Array<InstagramComment> | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (comments === null) {
      setLoading(true)
      const rows = await getInstagramComments({ data: { mediaId: post.mediaId } })
      setComments(rows)
      setLoading(false)
    }
  }

  const addReply = (commentId: string, reply: InstagramComment) => {
    setComments((prev) => prev && prev.map((c) => (c.id === commentId ? { ...c, replies: [...(c.replies ?? []), reply] } : c)))
  }

  return (
    <div className="rounded-[10px] border border-[#F5F5F5]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        {post.imageUrl ? (
          <img src={post.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#F5F5F5]">
            <Instagram className="h-4 w-4 text-[#C4C4C4]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[#1A1A1A]">{(post.caption || 'Untitled post').slice(0, 80)}</p>
          <p className="text-[10px] text-[#9CA3AF]">{post.at ? post.at.substring(0, 10) : ''}</p>
        </div>
        <span className="flex items-center gap-1 shrink-0 text-[13px] font-bold text-[#8B5CF6]">
          <MessageCircle className="h-3 w-3" /> {fmt(post.comments ?? 0)}
        </span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-[#9CA3AF]" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[#9CA3AF]" />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-[#F5F5F5] px-3 py-2">
          {loading ? (
            <p className="py-3 text-center text-[11px] text-[#9CA3AF]">Loading comments…</p>
          ) : !comments || comments.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-[#9CA3AF]">No comments on this post yet.</p>
          ) : (
            comments.map((c) => (
              <CommentRow key={c.id} comment={c} onReplied={(reply) => addReply(c.id, reply)} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// Metric drilldown for a Likes/Comments KPI tile — clicking a metric shows
// the detail inside the dashboard instead of redirecting out to Instagram.
// Likes stay a per-post breakdown (Instagram's API doesn't expose which
// individual users liked a post). Comments expand per-post into the actual
// commenter/text/date-time, fetched on demand via the Graph API.
export function InstagramMetricDialog({
  open, onOpenChange, metric, posts, total,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  metric: 'likes' | 'comments'
  posts: Array<InstagramPostInsight>
  total: number
}) {
  const label = metric === 'likes' ? 'Likes' : 'Comments'
  const Icon = metric === 'likes' ? Heart : MessageCircle
  const color = metric === 'likes' ? '#E1306C' : '#8B5CF6'
  const rows = posts
    .filter((p) => p[metric] != null && p[metric]! > 0)
    .sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" style={{ color }} /> {label} — {fmt(total)} total
          </DialogTitle>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-[#9CA3AF]">No per-post {label.toLowerCase()} data yet.</p>
        ) : metric === 'comments' ? (
          <div className="space-y-2">
            {rows.map((p) => <CommentsBreakdown key={p.mediaId} post={p} />)}
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((p) => (
              <div key={p.mediaId} className="flex items-center gap-3 rounded-[10px] border border-[#F5F5F5] px-3 py-2">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-[8px] object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#F5F5F5]">
                    <Instagram className="h-4 w-4 text-[#C4C4C4]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[#1A1A1A]">{(p.caption || 'Untitled post').slice(0, 80)}</p>
                  <p className="text-[10px] text-[#9CA3AF]">{p.at ? p.at.substring(0, 10) : ''}</p>
                </div>
                <span className="shrink-0 text-[13px] font-bold" style={{ color }}>{fmt(p[metric] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {metric === 'comments' ? (
          <p className="text-[10px] text-[#C4C4C4]">Click a post to see who commented — reply right here, it posts straight to Instagram.</p>
        ) : (
          <p className="text-[10px] text-[#C4C4C4]">
            Breakdown by post — Instagram's API doesn't expose which individual users liked a post.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
