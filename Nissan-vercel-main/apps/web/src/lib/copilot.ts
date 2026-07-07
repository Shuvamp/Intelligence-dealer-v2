import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'
import type {
  CopilotCitation, CopilotConversation, CopilotMessage, CopilotThread, DailyBriefing,
} from './types'

const FASTAPI_URL = (
  (typeof process !== 'undefined' && process.env['FASTAPI_URL']) || 'http://localhost:8000'
).replace(/\/$/, '')

async function authCtx(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthenticated')
  const { data } = await supabase.from('users').select('tenant_id, full_name').eq('id', user.id).single()
  return { userId: user.id, tenantId: data?.tenant_id as string, name: (data?.full_name as string) ?? 'there' }
}

export function suggestedPrompts(): Array<string> {
  return [
    'Which leads should I call today?',
    'Which campaign performed best?',
    'Which vehicle should I promote?',
    'What should I focus on today?',
  ]
}

// =====================================================================
// COPILOT BRAIN: FastAPI /marketing/copilot/ask (NVIDIA NIM) primary.
// Falls back to rule-based if FastAPI unavailable.
// =====================================================================

async function gatherSnapshot(
  supabase: ReturnType<typeof getSupabaseServerClient>,
): Promise<any> {
  const [hot, camps, sigs, brief] = await Promise.all([
    supabase
      .from('leads')
      .select('customer:customers!leads_customer_id_fkey(full_name), vehicle_interest, stage')
      .eq('score', 'hot')
      .not('stage', 'in', '(won,booked,delivered,lost)')
      .order('last_activity_at', { ascending: true })
      .limit(6),
    supabase
      .from('campaign_insights')
      .select('leads_generated, conversion_rate, cost_per_lead, campaigns(name)')
      .order('leads_generated', { ascending: false })
      .limit(3),
    supabase
      .from('market_signals')
      .select('title, metric_value, kind, severity')
      .in('severity', ['high', 'medium'])
      .order('created_at', { ascending: false })
      .limit(5),
    briefingData(supabase),
  ])
  return {
    hotLeads: ((hot.data ?? []) as Array<any>).map((r) => ({
      name: r.customer?.full_name ?? null,
      vehicle: r.vehicle_interest ?? null,
      stage: r.stage,
    })),
    campaigns: ((camps.data ?? []) as Array<any>).map((r) => ({
      name: r.campaigns?.name ?? null,
      leads: r.leads_generated,
      conversion: Number(r.conversion_rate),
      cpl: Number(r.cost_per_lead),
    })),
    signals: ((sigs.data ?? []) as Array<any>).map((r) => ({
      title: r.title,
      metric: r.metric_value ?? null,
      kind: r.kind,
    })),
    today: brief.lines,
  }
}

async function thinkRuleBased(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  question: string,
): Promise<{ answer: string; citations: Array<CopilotCitation> }> {
  const q = question.toLowerCase()

  if (q.includes('call') || (q.includes('lead') && !q.includes('source'))) {
    const { data } = await supabase
      .from('leads')
      .select('customer:customers!leads_customer_id_fkey(full_name), vehicle_interest, stage, score, last_activity_at')
      .eq('score', 'hot')
      .not('stage', 'in', '(won,booked,delivered,lost)')
      .order('last_activity_at', { ascending: true })
      .limit(5)
    const rows = (data ?? []) as any[]
    if (!rows.length) return { answer: 'No hot leads need a call right now — your pipeline is well tended.', citations: [] }
    const names = rows.map((r) => r.customer?.full_name).filter(Boolean)
    return {
      answer: `Call these ${rows.length} hot leads first — they're high-intent and waiting longest: ${names.join(', ')}. Lead with a test-drive offer for their vehicle of interest.`,
      citations: rows.map((r) => ({ kind: 'lead', label: `${r.customer?.full_name ?? 'Lead'} · ${r.vehicle_interest ?? ''}`.trim() })),
    }
  }

  if (q.includes('campaign') || q.includes('best') || q.includes('marketing')) {
    const { data } = await supabase
      .from('campaign_insights')
      .select('leads_generated, conversion_rate, cost_per_lead, campaigns(name)')
      .order('leads_generated', { ascending: false })
      .limit(1)
    const top = (data ?? [])[0] as any
    if (!top) return { answer: 'No campaign performance data yet.', citations: [] }
    const name = top.campaigns?.name ?? 'your top campaign'
    return {
      answer: `“${name}” is your best campaign — ${top.leads_generated} leads at ${Number(top.conversion_rate)}% conversion and ₹${top.cost_per_lead} cost per lead. Reuse its structure for next month.`,
      citations: [{ kind: 'campaign', label: name }],
    }
  }

  if (q.includes('vehicle') || q.includes('promote') || q.includes('region') || q.includes('demand')) {
    const { data: sig } = await supabase
      .from('market_signals')
      .select('title, metric_label, metric_value')
      .in('kind', ['demand', 'trend'])
      .order('created_at', { ascending: false })
      .limit(1)
    const s = (sig ?? [])[0] as any
    return {
      answer: `Promote the Magnite — it leads your enquiries${s ? `, and ${s.title.toLowerCase()} (${s.metric_value})` : ''}. Pair it with the X-Trail for the premium SUV segment.`,
      citations: s ? [{ kind: 'signal', label: `${s.metric_label}: ${s.metric_value}` }] : [],
    }
  }

  // default: daily focus
  const brief = await briefingData(supabase)
  return {
    answer: `Here's your focus today: ${brief.lines.map((l) => `${l.value} ${l.label.toLowerCase()}`).join(', ')}. Start with the hot leads, then review the campaign in approval.`,
    citations: brief.lines.map((l) => ({ kind: 'metric', label: `${l.label}: ${l.value}` })),
  }
}

async function briefingData(supabase: ReturnType<typeof getSupabaseServerClient>) {
  const [{ count: hot }, { count: pending }, { data: sig }] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('score', 'hot').not('stage', 'in', '(won,booked,delivered,lost)'),
    supabase.from('campaign_posts').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    supabase.from('market_signals').select('title').eq('severity', 'high').limit(1),
  ])
  const lines = [
    { label: 'Hot leads to work', value: String(hot ?? 0) },
    { label: 'Posts awaiting approval', value: String(pending ?? 0) },
  ]
  const top = (sig ?? [])[0] as any
  if (top) lines.push({ label: 'Top signal', value: top.title })
  return { headline: 'Your dealership at a glance', lines }
}

// ---- server functions ----

export const getDailyBriefing = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DailyBriefing> => briefingData(getSupabaseServerClient()),
)

export const getConversations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<CopilotConversation>> => {
    const supabase = getSupabaseServerClient()
    const { data } = await supabase
      .from('copilot_conversations')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false })
    return (data ?? []) as Array<CopilotConversation>
  },
)

export const getConversation = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<CopilotThread | null> => {
    const supabase = getSupabaseServerClient()
    const { data: conversation } = await supabase
      .from('copilot_conversations')
      .select('id, title, created_at, updated_at')
      .eq('id', data.id)
      .single()
    if (!conversation) return null
    const { data: messages } = await supabase
      .from('copilot_messages')
      .select('id, role, content, citations, created_at')
      .eq('conversation_id', data.id)
      .order('created_at', { ascending: true })
    return { conversation, messages: (messages ?? []) as Array<CopilotMessage> }
  })

export const sendMessage = createServerFn({ method: 'POST' })
  .validator((d: { conversation_id?: string; message: string }) => d)
  .handler(async ({ data }): Promise<{ conversation_id: string; answer: string; citations: Array<CopilotCitation> }> => {
    const supabase = getSupabaseServerClient()
    const { tenantId, userId } = await authCtx(supabase)

    let convoId = data.conversation_id
    if (!convoId) {
      const title = data.message.length > 48 ? data.message.slice(0, 48) + '…' : data.message
      const { data: c } = await supabase
        .from('copilot_conversations')
        .insert({ tenant_id: tenantId, user_id: userId, title })
        .select('id')
        .single()
      convoId = c?.id as string
    }

    await supabase.from('copilot_messages').insert({
      tenant_id: tenantId, conversation_id: convoId, role: 'user', content: data.message,
    })

    let answer: string
    let citations: Array<CopilotCitation> = []

    try {
      // Gather dealership snapshot from Supabase (BFF layer — stays in web)
      const snapshot = await gatherSnapshot(supabase)
      const snapshotContext = [
        snapshot.hotLeads.length
          ? `Hot leads: ${snapshot.hotLeads.map((l: any) => `${l.name ?? 'Unknown'} (${l.vehicle ?? ''})`).join(', ')}`
          : '',
        snapshot.campaigns.length
          ? `Campaigns: ${snapshot.campaigns.map((c: any) => `"${c.name}": ${c.leads} leads, ${c.conversion}% conv, ₹${c.cpl} CPL`).join('; ')}`
          : '',
        snapshot.signals.length
          ? `Signals: ${snapshot.signals.map((s: any) => s.title).join(', ')}`
          : '',
        snapshot.today.length
          ? `Today: ${snapshot.today.map((l: any) => `${l.label}: ${l.value}`).join(', ')}`
          : '',
      ].filter(Boolean).join('\n')

      const res = await fetch(`${FASTAPI_URL}/marketing/copilot/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: data.message,
          campaign_context: snapshot.campaigns.map((c: any) => ({
            name: c.name,
            leads_generated: c.leads,
            conversion_rate: c.conversion,
            cost_per_lead: c.cpl,
          })),
          snapshot_context: snapshotContext,
        }),
      })
      if (res.ok) {
        const json = await res.json() as { answer: string }
        answer = json.answer
      } else {
        throw new Error(`FastAPI copilot ${res.status}`)
      }
    } catch {
      // Rule-based fallback — reads from Supabase, no AI
      const rb = await thinkRuleBased(supabase, data.message)
      answer = rb.answer
      citations = rb.citations
    }

    await supabase.from('copilot_messages').insert({
      tenant_id: tenantId, conversation_id: convoId, role: 'assistant', content: answer, citations,
    })
    await supabase.from('copilot_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convoId)

    return { conversation_id: convoId, answer, citations }
  })
