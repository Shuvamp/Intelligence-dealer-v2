import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { Sparkles, ArrowRight } from 'lucide-react'
import {
  getConversations,
  getDailyBriefing,
  getConversation,
  sendMessage,
  suggestedPrompts,
} from '#/lib/copilot'
import { MessageBubble, TypingDots } from '#/components/copilot/copilot-ui'
import { CopilotSidebar } from '#/components/copilot/CopilotSidebar'
import { CopilotComposer } from '#/components/copilot/CopilotComposer'
import type { CopilotConversation, CopilotMessage, DailyBriefing } from '#/lib/types'

export const Route = createFileRoute('/_authed/copilot')({
  loader: async () => {
    const [conversations, briefing] = await Promise.all([
      getConversations(),
      getDailyBriefing(),
    ])
    return { conversations, briefing }
  },
  component: CopilotPage,
})

const authedRoute = getRouteApi('/_authed')

function tempMessage(role: CopilotMessage['role'], content: string): CopilotMessage {
  return {
    id: `tmp-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    citations: [],
    created_at: new Date().toISOString(),
  }
}

function CopilotPage() {
  const { conversations, briefing } = Route.useLoaderData() as {
    conversations: Array<CopilotConversation>
    briefing: DailyBriefing
  }
  const router = useRouter()
  const { user } = authedRoute.useRouteContext()
  const userName = user.profile.full_name

  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Array<CopilotMessage>>([])
  const [pending, setPending] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to bottom whenever the thread grows or the assistant is typing.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, pending])

  async function selectConversation(id: string) {
    if (id === activeId) return
    setActiveId(id)
    setMessages([])
    setLoadingThread(true)
    try {
      const thread = await getConversation({ data: { id } })
      setMessages(thread?.messages ?? [])
    } finally {
      setLoadingThread(false)
    }
  }

  function newChat() {
    setActiveId(null)
    setMessages([])
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || pending) return

    setMessages((prev) => [...prev, tempMessage('user', message)])
    setPending(true)
    try {
      const res = await sendMessage({
        data: { conversation_id: activeId ?? undefined, message },
      })
      setActiveId(res.conversation_id)
      setMessages((prev) => [
        ...prev,
        { ...tempMessage('assistant', res.answer), citations: res.citations },
      ])
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }

  const isEmpty = messages.length === 0 && !pending && !loadingThread

  return (
    <div className="fade-up flex h-[calc(100vh-7.5rem)] flex-col">
      <header className="mb-4 flex shrink-0 items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl brand-bg shadow-card">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-[26px] leading-none text-foreground">
            Executive Copilot
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            One assistant across leads, marketing and intelligence
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-5">
        <CopilotSidebar
          conversations={conversations}
          briefing={briefing}
          activeId={activeId}
          onSelect={selectConversation}
          onNewChat={newChat}
        />

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isEmpty ? (
              <Hero userName={userName} onPick={send} disabled={pending} />
            ) : (
              <div className="mx-auto w-full max-w-[760px] space-y-5 px-5 py-6">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} userName={userName} />
                ))}
                {pending ? (
                  <div className="flex gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full brand-bg">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="flex items-center rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
                      <TypingDots />
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border bg-card">
            <CopilotComposer onSend={send} disabled={pending} />
          </div>
        </section>
      </div>
    </div>
  )
}

function Hero({
  userName,
  onPick,
  disabled,
}: {
  userName: string
  onPick: (text: string) => void
  disabled: boolean
}) {
  const prompts = suggestedPrompts()
  const firstName = userName.split(' ')[0] ?? userName
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl brand-bg shadow-card">
        <Sparkles className="h-7 w-7" />
      </span>
      <h2 className="mt-5 font-display text-[30px] leading-tight text-foreground">
        Ask your dealership anything
      </h2>
      <p className="mt-2 max-w-[440px] text-[13.5px] leading-relaxed text-muted-foreground">
        Welcome back, {firstName}. I read your live leads, campaigns and market signals —
        ask a question and I'll answer with the data to back it up.
      </p>

      <div className="mt-7 grid w-full max-w-[620px] grid-cols-1 gap-2.5 sm:grid-cols-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-[13px] font-medium text-foreground shadow-card transition hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--brand)_40%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>{prompt}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
          </button>
        ))}
      </div>
    </div>
  )
}
