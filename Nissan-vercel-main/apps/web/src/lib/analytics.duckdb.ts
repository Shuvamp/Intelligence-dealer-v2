// Server-only. Campaigns/days/opportunities/assets proxy to the FastAPI /db/*
// layer (DuckDB lives in apps/api — no Vite HMR, no WAL corruption). Campaign
// posts use a separate web-local DuckDB file (no FastAPI endpoint yet); see the
// Campaign Posts CRUD section below.

const FASTAPI_URL = (() => {
  const raw = (
    (typeof process !== 'undefined' && process.env['FASTAPI_URL']) || 'http://localhost:8000'
  ).replace(/\/$/, '')
  // Tolerate a scheme-less env value (e.g. "host.up.railway.app"): fetch/new URL
  // require a protocol, so default a bare host to https://.
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`
})()

async function apiGet<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const url = new URL(FASTAPI_URL + path)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`[FastAPI] GET ${path} → ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function apiPost<T = { ok: boolean }>(path: string, body: unknown): Promise<T> {
  const res = await fetch(FASTAPI_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`[FastAPI] POST ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function apiDelete<T = { ok: boolean }>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(FASTAPI_URL + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`[FastAPI] DELETE ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Types (unchanged — marketing.ts imports these) ─────────────────────────────

export interface DuckCampaignRow {
  campaign_id: string
  tenant_id: string
  name: string
  objective: string
  status: string
  start_date: string | null
  end_date: string | null
  post_count: number
  published_count: number
  channels: string[]
  theme: string | null
  campaign_color?: string | null
  campaign_hashtags?: string[]
  posting_time?: string | null
  vehicle?: string | null
  goal?: string | null
  selected_assets?: string | null
  selected_logo?: string | null
  selected_logo_2?: string | null
}

// Generated post-content columns shared by campaign_days and opportunities.
export interface DuckContentFields {
  headline?: string | null
  subheadline?: string | null
  caption?: string | null
  hashtags?: string[] | null
  cta?: string | null
  offer?: string | null
  content_status?: string | null
  scheduled_at?: string | null
  publish_status?: string | null
  published_at?: string | null
  poster_url?: string | null
  video_url?: string | null
  channel_status?: string | null
  selected_channels?: string[] | null
}

export interface DuckPublishingRow extends DuckContentFields {
  kind: 'campaign' | 'event'
  group_id: string
  title: string | null
  day_num?: number
  date: string
  theme?: string | null
  vehicle?: string | null
}

export interface DuckCampaignDayRow extends DuckContentFields {
  campaign_id: string
  tenant_id: string
  day_date: string
  day_num: number
  theme: string
  vehicle?: string | null
}

export interface DuckOpportunityRow extends DuckContentFields {
  id: string
  tenant_id: string
  month: number
  year: number
  date: string
  name: string
  kind: string
  theme: string
  suggestion: string
}

export interface DuckAssetRow {
  id: string
  tenant_id: string
  name: string
  asset_type: 'vehicle' | 'logo' | 'background' | 'brand_asset'
  vehicle?: string | null
  sub_category?: string | null
  file_url: string
  file_size?: number | null
  metadata?: string | null
  created_at: string
}

// ── Campaigns ──────────────────────────────────────────────────────────────────

export async function upsertCampaign(row: DuckCampaignRow): Promise<void> {
  await apiPost('/db/campaigns/upsert', row)
}

export async function upsertCampaigns(rows: DuckCampaignRow[]): Promise<void> {
  if (rows.length === 0) return
  await apiPost('/db/campaigns/upsert-batch', rows)
}

export async function deleteCampaign(campaignId: string, tenantId: string): Promise<void> {
  await apiDelete(`/db/campaigns/${campaignId}`, { tenant_id: tenantId })
}

export async function listCampaigns(tenantId: string): Promise<DuckCampaignRow[]> {
  const rows = await apiGet<DuckCampaignRow[]>('/db/campaigns', { tenant_id: tenantId })
  return rows.map((r) => ({
    ...r,
    channels: r.channels ?? [],
    campaign_hashtags: r.campaign_hashtags ?? [],
  }))
}

// ── Campaign Days ──────────────────────────────────────────────────────────────

export async function upsertCampaignDays(rows: DuckCampaignDayRow[]): Promise<void> {
  if (rows.length === 0) return
  await apiPost('/db/campaign-days/upsert', rows)
}

export async function listAllCampaignDays(tenantId: string): Promise<DuckCampaignDayRow[]> {
  return apiGet<DuckCampaignDayRow[]>('/db/campaign-days', { tenant_id: tenantId })
}

export async function updateDayContent(
  campaignId: string, tenantId: string, dayDate: string, fields: DuckContentFields,
): Promise<void> {
  await apiPost('/db/campaign-days/update-content', {
    campaign_id: campaignId, tenant_id: tenantId, day_date: dayDate, ...fields,
  })
}

// ── Opportunities ──────────────────────────────────────────────────────────────

export async function upsertOpportunities(rows: DuckOpportunityRow[]): Promise<void> {
  if (rows.length === 0) return
  await apiPost('/db/opportunities/upsert', rows)
}

export async function updateOpportunityContent(
  id: string, tenantId: string, fields: DuckContentFields,
): Promise<void> {
  await apiPost('/db/opportunities/update-content', { id, tenant_id: tenantId, ...fields })
}

// ── Publishing pipeline ──────────────────────────────────────────────────────

export async function approveCampaignDb(campaignId: string, tenantId: string, postTime: string): Promise<void> {
  await apiPost('/db/publishing/approve-campaign', { campaign_id: campaignId, tenant_id: tenantId, post_time: postTime })
}
export async function rejectCampaignDb(campaignId: string, tenantId: string): Promise<void> {
  await apiPost('/db/publishing/reject-campaign', { campaign_id: campaignId, tenant_id: tenantId })
}
export async function publishCampaignDb(campaignId: string, tenantId: string): Promise<void> {
  await apiPost('/db/publishing/publish-campaign', { campaign_id: campaignId, tenant_id: tenantId })
}
export async function approveEventDb(id: string, tenantId: string, postTime: string): Promise<void> {
  await apiPost('/db/publishing/approve-event', { id, tenant_id: tenantId, post_time: postTime })
}
export async function rejectEventDb(id: string, tenantId: string): Promise<void> {
  await apiPost('/db/publishing/reject-event', { id, tenant_id: tenantId })
}
export async function publishEventDb(id: string, tenantId: string): Promise<void> {
  await apiPost('/db/publishing/publish-event', { id, tenant_id: tenantId })
}
export async function listPublishingDb(tenantId: string): Promise<DuckPublishingRow[]> {
  return apiGet<DuckPublishingRow[]>('/db/publishing', { tenant_id: tenantId })
}

export async function listOpportunities(
  tenantId: string,
  month: number,
  year: number,
): Promise<DuckOpportunityRow[]> {
  return apiGet<DuckOpportunityRow[]>('/db/opportunities', {
    tenant_id: tenantId,
    month,
    year,
  })
}

// ── Campaign Posts CRUD ────────────────────────────────────────────────────
// Real Supabase public.campaign_posts (0010_marketing.sql + 0044 gapfill) —
// same table runCompliance/setStatus/approvePost/etc. in marketing.ts already
// read/write directly via supabase.from('campaign_posts'). post_id here maps
// to that table's `id` column.

import { getSupabaseServerClient } from './supabase.server'

export interface DuckPostRow {
  post_id: string
  tenant_id: string
  campaign_id?: string | null
  title?: string | null
  caption?: string | null
  cta?: string | null
  hashtags?: string[] | null
  channel?: string | null
  status?: string
  compliance?: string
  compliance_score?: number | null
  vehicle?: string | null
  offer?: string | null
  headline?: string | null
  subheadline?: string | null
  poster_prompt?: string | null
  poster_url?: string | null
  poster_provider?: string | null
  rejection_reason?: string | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

function toDuckPostRow(r: Record<string, unknown>): DuckPostRow {
  return { ...r, post_id: r['id'] } as DuckPostRow
}

export async function insertCampaignPost(row: DuckPostRow): Promise<void> {
  const supabase = getSupabaseServerClient()
  const { error } = await supabase.from('campaign_posts').insert({
    id: row.post_id,
    tenant_id: row.tenant_id,
    campaign_id: row.campaign_id ?? null,
    title: row.title ?? null,
    caption: row.caption ?? null,
    cta: row.cta ?? null,
    hashtags: row.hashtags ?? null,
    channel: row.channel ?? undefined,
    status: row.status ?? 'draft',
    compliance: row.compliance ?? 'unchecked',
    vehicle: row.vehicle ?? null,
    offer: row.offer ?? null,
    headline: row.headline ?? null,
    subheadline: row.subheadline ?? null,
    poster_prompt: row.poster_prompt ?? null,
    poster_url: row.poster_url ?? null,
    poster_provider: row.poster_provider ?? null,
    created_by: row.created_by ?? null,
  })
  if (error) throw new Error(`[campaign_posts] insert failed: ${error.message}`)
}

export async function getCampaignPostById(postId: string, tenantId: string): Promise<DuckPostRow | null> {
  const supabase = getSupabaseServerClient()
  const { data } = await supabase
    .from('campaign_posts')
    .select('*')
    .eq('id', postId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data ? toDuckPostRow(data) : null
}

export async function updateCampaignPost(
  postId: string,
  tenantId: string,
  updates: Partial<Pick<DuckPostRow,
    'poster_prompt' | 'poster_url' | 'poster_provider' |
    'status' | 'compliance' | 'compliance_score' | 'rejection_reason'>>,
): Promise<void> {
  if (Object.keys(updates).length === 0) return
  const supabase = getSupabaseServerClient()
  const { error } = await supabase
    .from('campaign_posts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`[campaign_posts] update failed: ${error.message}`)
}

export async function listCampaignPostsByTenant(tenantId: string): Promise<DuckPostRow[]> {
  const supabase = getSupabaseServerClient()
  const { data } = await supabase
    .from('campaign_posts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(toDuckPostRow)
}

export async function listCampaignPostsByCampaign(campaignId: string, tenantId: string): Promise<DuckPostRow[]> {
  const supabase = getSupabaseServerClient()
  const { data } = await supabase
    .from('campaign_posts')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  return (data ?? []).map(toDuckPostRow)
}

// ── Analytics (read-only aggregations) ────────────────────────────────────

export async function queryObjectiveBreakdown(
  tenantId: string,
): Promise<Array<{ objective: string; total: number; posts: number }>> {
  return apiGet('/db/analytics/objectives', { tenant_id: tenantId })
}

// ── Marketing Assets ───────────────────────────────────────────────────────────

export async function upsertAsset(row: DuckAssetRow): Promise<void> {
  await apiPost('/db/assets/upsert', row)
}

export async function listAssets(
  tenantId: string,
  filters?: { asset_type?: string; vehicle?: string; search?: string },
): Promise<DuckAssetRow[]> {
  return apiGet<DuckAssetRow[]>('/db/assets', {
    tenant_id: tenantId,
    ...(filters ?? {}),
  })
}

export async function deleteAssetRow(assetId: string, tenantId: string): Promise<void> {
  await apiDelete(`/db/assets/${assetId}`, { tenant_id: tenantId })
}
