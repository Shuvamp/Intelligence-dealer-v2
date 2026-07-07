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
// Posts stay in a web-local DuckDB file (.duckdb/analytics.duckdb under apps/web)
// — separate from the FastAPI-owned store, so no cross-process file lock.

import { Database } from 'duckdb-async'
import path from 'node:path'
import fs from 'node:fs'

const DB_DIR = path.resolve(process.cwd(), '.duckdb')
const DB_PATH = path.join(DB_DIR, 'analytics.duckdb')

// Store on Node.js global so Vite's SSR module re-evaluation (which resets
// module-level vars on each server function call) doesn't create a second
// Database instance → second exclusive file lock → Windows IO error.
declare global {
  // eslint-disable-next-line no-var
  var __adip_duckdb: Database | undefined
  // eslint-disable-next-line no-var
  var __adip_duckdb_ready: Promise<Database> | undefined
}

async function getDb(): Promise<Database> {
  if (global.__adip_duckdb) return global.__adip_duckdb
  // Guard against concurrent first-open calls
  if (global.__adip_duckdb_ready) return global.__adip_duckdb_ready
  global.__adip_duckdb_ready = (async () => {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
    const db = await Database.create(DB_PATH)
    await bootstrap(db)
    global.__adip_duckdb = db
    return db
  })()
  return global.__adip_duckdb_ready
}

async function bootstrap(db: Database) {
  const conn = await db.connect()
  try {
    // Campaign posts — generated content + poster, keyed by post_id
    await conn.run(`
      CREATE TABLE IF NOT EXISTS campaign_posts (
        post_id          VARCHAR NOT NULL PRIMARY KEY,
        tenant_id        VARCHAR NOT NULL,
        campaign_id      VARCHAR,
        title            VARCHAR,
        caption          TEXT,
        cta              VARCHAR,
        hashtags         VARCHAR,
        channel          VARCHAR,
        status           VARCHAR NOT NULL DEFAULT 'draft',
        compliance       VARCHAR NOT NULL DEFAULT 'unchecked',
        compliance_score INTEGER,
        vehicle          VARCHAR,
        offer            VARCHAR,
        headline         VARCHAR,
        subheadline      VARCHAR,
        poster_prompt    TEXT,
        poster_url       TEXT,
        poster_provider  VARCHAR,
        rejection_reason VARCHAR,
        created_by       VARCHAR,
        created_at       TIMESTAMP NOT NULL DEFAULT now(),
        updated_at       TIMESTAMP NOT NULL DEFAULT now()
      )
    `)
    // Idempotent columns for existing DBs (swallowed if already exist)
    await conn.run(`ALTER TABLE campaign_posts ADD COLUMN subheadline VARCHAR`).catch(() => {})
    await conn.run(`ALTER TABLE campaign_posts ADD COLUMN poster_provider VARCHAR`).catch(() => {})
    await conn.run(`ALTER TABLE campaign_posts ADD COLUMN compliance_score INTEGER`).catch(() => {})
    await conn.run(`ALTER TABLE campaign_posts ADD COLUMN rejection_reason VARCHAR`).catch(() => {})
  } finally {
    await conn.close()
  }
}

function joinArr(arr: string[] | null | undefined): string | null {
  return arr && arr.length > 0 ? arr.join(',') : null
}

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

export async function insertCampaignPost(row: DuckPostRow): Promise<void> {
  const db = await getDb()
  const conn = await db.connect()
  try {
    await conn.run(
      `INSERT INTO campaign_posts
         (post_id, tenant_id, campaign_id, title, caption, cta, hashtags,
          channel, status, compliance, vehicle, offer, headline, subheadline,
          poster_prompt, poster_url, poster_provider, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.post_id,
      row.tenant_id,
      row.campaign_id   ?? null,
      row.title         ?? null,
      row.caption       ?? null,
      row.cta           ?? null,
      joinArr(row.hashtags),
      row.channel       ?? null,
      row.status        ?? 'draft',
      row.compliance    ?? 'unchecked',
      row.vehicle       ?? null,
      row.offer         ?? null,
      row.headline      ?? null,
      row.subheadline   ?? null,
      row.poster_prompt ?? null,
      row.poster_url    ?? null,
      row.poster_provider ?? null,
      row.created_by    ?? null,
    )
  } finally {
    await conn.close()
  }
}

export async function getCampaignPostById(postId: string, tenantId: string): Promise<DuckPostRow | null> {
  const db = await getDb()
  const conn = await db.connect()
  try {
    const rows = await conn.all(
      `SELECT * FROM campaign_posts WHERE post_id = ? AND tenant_id = ?`,
      postId, tenantId,
    ) as Record<string, unknown>[]
    if (!rows[0]) return null
    const r = rows[0]
    return {
      ...r,
      hashtags: typeof r['hashtags'] === 'string' && r['hashtags']
        ? (r['hashtags'] as string).split(',').filter(Boolean)
        : [],
    } as DuckPostRow
  } finally {
    await conn.close()
  }
}

export async function updateCampaignPost(
  postId: string,
  tenantId: string,
  updates: Partial<Pick<DuckPostRow,
    'poster_prompt' | 'poster_url' | 'poster_provider' |
    'status' | 'compliance' | 'compliance_score' | 'rejection_reason'>>,
): Promise<void> {
  const fields = Object.keys(updates).filter(k => k in updates)
  if (fields.length === 0) return
  const db = await getDb()
  const conn = await db.connect()
  try {
    const setClauses = fields.map(f => `${f} = ?`).join(', ')
    const values = fields.map(f => (updates as Record<string, unknown>)[f] ?? null)
    await conn.run(
      `UPDATE campaign_posts SET ${setClauses}, updated_at = now()
       WHERE post_id = ? AND tenant_id = ?`,
      ...values, postId, tenantId,
    )
  } finally {
    await conn.close()
  }
}

export async function listCampaignPostsByTenant(tenantId: string): Promise<DuckPostRow[]> {
  const db = await getDb()
  const conn = await db.connect()
  try {
    const rows = await conn.all(
      `SELECT * FROM campaign_posts WHERE tenant_id = ? ORDER BY created_at DESC`,
      tenantId,
    ) as Record<string, unknown>[]
    return rows.map(r => ({
      ...r,
      hashtags: typeof r['hashtags'] === 'string' && r['hashtags']
        ? (r['hashtags'] as string).split(',').filter(Boolean)
        : [],
    })) as DuckPostRow[]
  } finally {
    await conn.close()
  }
}

export async function listCampaignPostsByCampaign(campaignId: string, tenantId: string): Promise<DuckPostRow[]> {
  const db = await getDb()
  const conn = await db.connect()
  try {
    const rows = await conn.all(
      `SELECT * FROM campaign_posts WHERE campaign_id = ? AND tenant_id = ? ORDER BY created_at DESC`,
      campaignId, tenantId,
    ) as Record<string, unknown>[]
    return rows.map(r => ({
      ...r,
      hashtags: typeof r['hashtags'] === 'string' && r['hashtags']
        ? (r['hashtags'] as string).split(',').filter(Boolean)
        : [],
    })) as DuckPostRow[]
  } finally {
    await conn.close()
  }
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
