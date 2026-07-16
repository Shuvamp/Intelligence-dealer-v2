// Shared domain types for the spine. Module domains (Lead, Campaign, …) are added
// in Phase 2; these mirror the Tier 1 schema.

// JSON-serializable value. Use this (not `unknown`) for jsonb columns so server
// function return types pass TanStack Start's serializable-type check.
export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type UserRole =
  | 'dealer_owner'
  | 'dealer_manager'
  | 'sales_executive'
  | 'marketing_executive'

export type SubscriptionPlan = 'starter' | 'growth' | 'intelligence' | 'enterprise'

export interface TenantBranding {
  logo_url?: string | null
  primary_color?: string | null
  theme?: 'light' | 'dark' | null
}

export interface Tenant {
  id: string
  name: string
  brand: string
  subscription_plan: SubscriptionPlan
  branding: TenantBranding
}

export interface Profile {
  id: string
  full_name: string
  email: string
  role: UserRole
  tenant_id: string
}

export interface SessionUser {
  profile: Profile
  tenant: Tenant
}

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  preferred_vehicle: string | null
  source_channel: string | null
  location_id: string | null
  created_at: string
}

export interface NotificationRow {
  id: string
  title: string
  message: string
  status: 'unread' | 'read' | 'dismissed'
  created_at: string
}

export interface AuditRow {
  id: string
  action: string
  entity_type: string | null
  metadata: Record<string, JsonValue>
  created_at: string
}

// ---- Lead Management module ----

export type LeadSource =
  | 'oem' | 'website' | 'facebook' | 'instagram' | 'walkin' | 'phone' | 'event' | 'referral'
// Phase 2 (Lead Board UI) added `booked`/`delivered` as a two-step replacement
// for `won`. `qualified`/`quotation`/`won` are kept (not dropped) for backward
// compatibility — existing rows and lead_events.metadata still reference them,
// and Postgres can't drop enum values without a destructive rename/recreate.
// New writes only ever use the 7 BOARD_STAGES values going forward; legacy
// values are folded onto a board column for display via BOARD_COLUMN_FOR_STAGE.
export type LeadStage =
  | 'new' | 'contacted' | 'qualified' | 'test_drive' | 'quotation' | 'negotiation'
  | 'booked' | 'delivered' | 'won' | 'lost'
export type LeadScoreBand = 'hot' | 'warm' | 'cold' | 'dead'
export type LeadEventType =
  | 'note' | 'call' | 'email' | 'whatsapp' | 'stage_change' | 'assignment' | 'test_drive' | 'quotation' | 'agent' | 'nba'

// Full vocabulary (includes legacy values still present in historical data).
export const LEAD_STAGES: Array<LeadStage> = [
  'new', 'contacted', 'qualified', 'test_drive', 'quotation', 'negotiation',
  'booked', 'delivered', 'won', 'lost',
]
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', qualified: 'Qualified', test_drive: 'Test Drive',
  quotation: 'Quotation', negotiation: 'Negotiation', booked: 'Booked', delivered: 'Delivered',
  won: 'Won', lost: 'Lost',
}

// Phase 2 Kanban board columns — the 7 stages a lead actually moves through
// going forward. `qualified`/`quotation`/`won` never appear as a column;
// existing leads sitting on those legacy values are folded onto the nearest
// board column for display by BOARD_COLUMN_FOR_STAGE.
export const BOARD_STAGES: Array<LeadStage> = [
  'new', 'contacted', 'test_drive', 'negotiation', 'booked', 'delivered', 'lost',
]
export const BOARD_COLUMN_FOR_STAGE: Record<LeadStage, LeadStage> = {
  new: 'new',
  contacted: 'contacted',
  qualified: 'contacted',
  test_drive: 'test_drive',
  quotation: 'negotiation',
  negotiation: 'negotiation',
  booked: 'booked',
  delivered: 'delivered',
  won: 'booked',
  lost: 'lost',
}
// Stages that count as "closed-won" for analytics (intelligence.ts, queries.ts,
// reports.ts) — was just `won`, now also booked/delivered.
export const WON_STAGES: ReadonlySet<LeadStage> = new Set(['won', 'booked', 'delivered'])
export const CLOSED_STAGES: ReadonlySet<LeadStage> = new Set(['won', 'booked', 'delivered', 'lost'])

export interface Lead {
  id: string
  tenant_id: string
  location_id: string | null
  customer_id: string | null
  source: LeadSource
  stage: LeadStage
  score: LeadScoreBand
  score_value: number
  assigned_to: string | null
  vehicle_interest: string | null
  budget: number | null
  notes: string | null
  created_at: string
  updated_at: string
  last_activity_at: string
  customer_name: string | null
  assignee_name: string | null
  // Intake-pipeline fields (Partha's normalize + Csriram's scoring attribution).
  test_drive_required?: boolean | null
  purchase_timeline_days?: number | null
  callback_within_days?: number | null
  contact_medium?: string | null
  // Enquiry-form scoring-signal fields (captured at intake, surfaced in Key facts).
  financing?: string | null
  nissan_relationship?: string | null
  brand_consideration?: string | null
  comparing_brands?: string | null
  purchase_reason?: string | null
  scored_by?: string | null
  score_reasons?: Array<string> | null
  // Set when scoring took a non-ideal path (primary key rate-limited → backup, or
  // full deterministic fallback). Null = normal. Drives the scoring-issue popup.
  score_notice?: string | null
}

export interface LeadEvent {
  id: string
  lead_id: string
  type: LeadEventType
  summary: string
  metadata: Record<string, JsonValue>
  created_by: string | null
  created_at: string
}

export interface LeadColumn {
  stage: LeadStage
  leads: Array<Lead>
  count: number
  value: number
}

export interface LeadStats {
  total: number
  hot: number
  warm: number
  cold: number // includes dead leads (treated as cold priority)
  unassigned: number
  pipelineValue: number
  wonValue: number
  winRate: number // 0-100
}

export interface LeadBoard {
  columns: Array<LeadColumn>
  stats: LeadStats
}

// ---- Phase 2 detail-view sections: Messages / Tasks / Documents ----
// Call History has no table of its own — it's lead_events filtered to type
// === 'call' (see CallHistory in CustomerLeadStatus.tsx / leads.$leadId.tsx).

export type LeadMessageChannel = 'whatsapp' | 'sms' | 'email' | 'call_note'
export type LeadMessageDirection = 'inbound' | 'outbound'

export type WhatsAppMessageStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface LeadMessage {
  id: string
  lead_id: string
  channel: LeadMessageChannel
  direction: LeadMessageDirection
  body: string
  // 'agent' = persisted from the Follow-up Agent's drafted message; 'manual' = logged by a user.
  source: string
  created_by: string | null
  created_at: string
  // WhatsApp Agent (Phase 4) — nullable on non-WhatsApp rows
  whatsapp_message_id?: string | null
  status?: WhatsAppMessageStatus | null
  template_id?: string | null
  attachment_id?: string | null
  error_reason?: string | null
}

export type LeadTaskStatus = 'open' | 'done'

export interface LeadTask {
  id: string
  lead_id: string
  title: string
  due_at: string | null
  status: LeadTaskStatus
  assigned_to: string | null
  created_at: string
  completed_at: string | null
}

// Documents: stubbed data model only (no upload/storage wiring this phase).
export interface LeadDocument {
  id: string
  lead_id: string
  file_name: string
  url: string | null
  uploaded_by: string | null
  created_at: string
}

// Phase 6: Dynamic Re-Scoring — one row per score change in lead_score_history.
export interface ScoreHistoryEntry {
  id: string
  lead_id: string
  score: LeadScoreBand
  score_value: number
  previous_score: LeadScoreBand | null
  previous_value: number | null
  trigger: string   // whatsapp_replied|stage_change|manual|call_completed|...
  scored_by: string | null
  score_reasons: Array<string>
  created_at: string
}

export interface LeadDetail {
  lead: Lead
  customer: Customer | null
  events: Array<LeadEvent>
  messages: Array<LeadMessage>
  tasks: Array<LeadTask>
  score_history: Array<ScoreHistoryEntry>  // Phase 6: newest-first, capped at 10
}

export interface SalesMember {
  id: string
  full_name: string
  role: UserRole
}

// ---- Marketing Intelligence module ----

export type CampaignObjective = 'awareness' | 'lead_gen' | 'offer' | 'festival' | 'launch'
export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'archived'
export type PostChannel = 'facebook' | 'instagram' | 'google_business' | 'whatsapp'
export type PostStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type PostCompliance = 'unchecked' | 'approved' | 'flagged'

export interface Campaign {
  id: string
  tenant_id: string
  location_id: string | null
  name: string
  theme: string | null
  objective: CampaignObjective
  status: CampaignStatus
  channels: Array<string>
  start_date: string | null
  end_date: string | null
  budget: number | null
  color: string | null
  campaign_hashtags: Array<string>
  created_at: string
  updated_at: string
}

export interface CampaignPost {
  id: string
  tenant_id: string
  campaign_id: string | null
  title: string | null
  caption: string | null
  cta: string | null
  hashtags: Array<string>
  channel: PostChannel
  status: PostStatus
  compliance: PostCompliance
  vehicle: string | null
  offer: string | null
  poster_url: string | null
  poster_prompt: string | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  campaign_name?: string | null
}

export interface CampaignInsight {
  id: string
  campaign_id: string
  reach: number
  impressions: number
  engagement: number
  leads_generated: number
  conversions: number
  spend: number
  cost_per_lead: number
  conversion_rate: number
  captured_at: string
}

export interface MarketingOverview {
  activeCampaigns: number
  contentInPipeline: number
  pendingApproval: number
  publishedThisMonth: number
  leadsAttributed: number
  costPerLead: number
}

export type OpportunityKind = 'festival' | 'holiday' | 'regional' | 'dealership'

// Lifecycle of AI-generated post content for a day or event.
export type ContentStatus = 'pending' | 'generated' | 'edited' | 'approved'

// Publishing pipeline state for an approved item. 'failed' = every targeted
// channel errored or was skipped on the scheduled/manual attempt (e.g.
// YouTube selected with no video attached) — see channel_status for why.
export type PublishStatus = 'draft' | 'queued' | 'published' | 'failed' | 'rejected'

// Post-ready copy attached to a campaign day or a calendar event.
export interface GeneratedContent {
  headline?: string
  subheadline?: string
  caption?: string
  hashtags?: Array<string>
  cta?: string
  offer?: string | null
  content_status?: ContentStatus
  scheduled_at?: string | null   // ISO 'YYYY-MM-DDTHH:MM'
  publish_status?: PublishStatus
  published_at?: string | null
  poster_url?: string | null     // generated AI poster (served from /posters/…)
  video_url?: string | null      // attached video (served from /videos/…) — required for YouTube
  channel_status?: string | null // JSON-encoded per-platform outcome from the last publish attempt
}

// A row in the Publishing queue/log — a campaign day or a calendar event.
export interface PublishingItem {
  kind: 'campaign' | 'event'
  group_id: string            // campaign_id (campaign) or opportunity id (event)
  title: string               // campaign name or event name
  day_num?: number
  date: string                // YYYY-MM-DD
  theme?: string
  vehicle?: string | null
  headline?: string | null
  caption?: string | null
  hashtags?: Array<string> | null
  cta?: string | null
  poster_url?: string | null
  video_url?: string | null
  scheduled_at?: string | null
  publish_status: PublishStatus
  published_at?: string | null
  channel_status?: string | null
}

export interface MonthOpportunity extends GeneratedContent {
  id?: string // DuckDB key, present once persisted (needed to save content)
  date: string // ISO date
  name: string
  kind: OpportunityKind
  theme: string
  suggestion: string
}
export interface MonthPlan {
  month: number // 1-12
  label: string
  opportunities: Array<MonthOpportunity>
}

export interface RecommendedCampaign {
  title: string
  rationale: string
  priority: 'high' | 'medium' | 'low'
  vehicle: string | null
}

export interface CampaignSummary extends Campaign {
  postCount: number
  publishedCount: number
  vehicles?: string[]
  posting_time?: string | null
  goal?: string | null
  selected_assets?: SelectedAsset[]
  selected_logo?: SelectedAsset | null
}

export interface CampaignScorecard extends CampaignInsight {
  campaign_name: string
}

// ---- Market Intelligence module ----

export type SignalKind = 'demand' | 'intent' | 'opportunity' | 'trend' | 'risk'
export type SignalSeverity = 'low' | 'medium' | 'high'
export type SignalStatus = 'open' | 'watching' | 'actioned' | 'dismissed'

export interface MarketSignal {
  id: string
  kind: SignalKind
  title: string
  detail: string | null
  metric_label: string | null
  metric_value: string | null
  severity: SignalSeverity
  source_module: string | null
  status: SignalStatus
  created_at: string
}

export interface IntelligenceOverview {
  totalLeads: number
  conversionRate: number // %
  topSource: string
  topVehicle: string
  pipelineValue: number
  bestCampaign: string
}

export interface SourceAnalytic {
  source: LeadSource
  count: number
  hot: number
  won: number
  conversionRate: number // %
}

export interface FunnelStage {
  stage: LeadStage
  count: number
}

export interface DemandItem {
  label: string
  count: number
  hot: number
}

export interface CampaignPerformance {
  campaign_id: string
  name: string
  reach: number
  engagement: number
  leads: number
  costPerLead: number
  conversionRate: number
  roiLabel: string
}

export interface IntelRecommendation {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
}

export interface ChannelAnalytic {
  channel: PostChannel
  postCount: number
  publishedCount: number
  pendingCount: number
  approvedCompliance: number
  flaggedCompliance: number
  campaignCount: number
  reach: number
  leads: number
  avgCpl: number
}

export interface CampaignHealth {
  totalPosts: number
  published: number
  pendingApproval: number
  draft: number
  rejected: number
  compliancePassRate: number
  activeCampaigns: number
  totalCampaigns: number
}

export interface VelocityWeek {
  weekLabel: string
  count: number
  hot: number
}

export interface LostLeadInsight {
  count: number
  topVehicle: string
  topSource: string
  avgBudget: number
}

// ---- Executive Copilot module ----

export type CopilotRole = 'user' | 'assistant'

export interface CopilotCitation {
  kind: string // 'lead' | 'campaign' | 'signal' | 'metric'
  label: string
}

export interface CopilotMessage {
  id: string
  role: CopilotRole
  content: string
  citations: Array<CopilotCitation>
  created_at: string
}

export interface CopilotConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface CopilotThread {
  conversation: CopilotConversation
  messages: Array<CopilotMessage>
}

export interface DailyBriefing {
  headline: string
  lines: Array<{ label: string; value: string }>
}

// ---- Media Library ----

export interface MediaAsset {
  id: string
  tenant_id: string
  name: string
  asset_type: 'vehicle' | 'logo' | 'background' | 'brand_asset'
  vehicle?: string | null
  sub_category?: string | null
  file_url: string        // /uploads/{uuid}.ext — served by Vite
  file_size?: number | null
  metadata?: string | null
  created_at: string
}

export interface SelectedAsset {
  vehicle: string
  asset_id: string
  asset_name?: string
  file_url?: string | null
}

// ---- Connected Channels ----

export interface ChannelConnection {
  channel: string
  status: 'connected' | 'disconnected'
  handle: string | null
  last_sync: string | null
  account_id?: string | null    // platform account/page ID (e.g. page_id, linkedin_id)
  account_name?: string | null  // connected account / page display name
}

export type LinkedInState = 'not_connected' | 'connected' | 'reconnect_required' | 'error'

export interface LinkedInProfile {
  linkedin_id: string | null
  name: string | null
  email: string | null
  picture: string | null
  profile_url?: string | null
  given_name?: string | null
  family_name?: string | null
  email_verified?: boolean | null
  locale?: string | null
  last_sync: string | null
}

export interface LinkedInProfileResult {
  state: LinkedInState
  profile: LinkedInProfile | null
}

export type YouTubeState = 'not_connected' | 'connected' | 'reconnect_required' | 'error'

export interface YouTubeStatus {
  connected: boolean
  handle: string | null
  last_sync: string | null
  channel_id: string | null
  channel_name: string | null
}

// Per-platform outcome from POST /api/publish. status: success | skipped | error.
export interface PublishPlatformResult {
  status: 'success' | 'skipped' | 'error'
  post_id?: string
  video_id?: string   // youtube success
  video_url?: string  // youtube success — https://www.youtube.com/watch?v=...
  reason?: string
  error?: string
}
export type PublishResult = Record<string, PublishPlatformResult>

// ---- Reports ----

export interface ReportsData {
  sales: {
    totalLeads: number
    won: number
    lost: number
    conversionRate: number // %
    pipelineValue: number
    wonValue: number
  }
  sources: Array<{ source: LeadSource; count: number; won: number; conversionRate: number }>
  campaigns: Array<{ name: string; leads: number; conversionRate: number; costPerLead: number; spend: number }>
  team: Array<{
    name: string
    role: UserRole | null
    total: number
    won: number
    hot: number
    conversionRate: number
    pipelineValue: number
  }>
}

// ---- Subscription / account ----

export interface AccountUsage {
  plan: SubscriptionPlan
  users: number
  locations: number
  customers: number
  leads: number
  campaigns: number
}

// ---- Campaign Planner Agent ----

export type CampaignType =
  | 'Event Campaign'
  | 'Festival Campaign'
  | 'Vehicle Promotion'
  | 'Service Promotion'
  | 'Seasonal Campaign'
  | 'Brand Awareness Campaign'

export type CampaignGoal =
  | 'Lead Generation'
  | 'Test Drive Booking'
  | 'Sales Promotion'
  | 'Brand Awareness'
  | 'Service Promotion'
  | 'Customer Retention'

export interface CampaignPlanInput {
  campaign_name: string
  campaign_type: CampaignType
  start_date: string      // YYYY-MM-DD
  end_date: string        // YYYY-MM-DD
  posting_time: string    // e.g. "10:00 AM"
  vehicles: string[]      // multi-select vehicle names
  goal: CampaignGoal
  notes: string           // optional additional notes
  campaign_color?: string | null
  selected_assets?: SelectedAsset[]
  selected_logo?: SelectedAsset | null
}

export interface CampaignDay extends GeneratedContent {
  campaign_id?: string  // populated when read from DB; absent in AI output
  date: string          // YYYY-MM-DD
  day_num: number
  theme: string
  vehicle?: string      // featured vehicle for this day (rotated across selection)
}

export interface CampaignPlanResult {
  campaign_name: string
  campaign_type: string
  vehicles: string[]
  goal: string
  start_date: string
  end_date: string
  posting_time: string
  days: CampaignDay[]
  campaign_color?: string | null
  selected_assets?: SelectedAsset[]
  selected_logo?: SelectedAsset | null
}

export interface DealershipMember {
  id: string
  full_name: string
  email: string
  role: UserRole
  status: string
}
export interface DealershipLocation {
  id: string
  name: string
  status: string
}
export interface DealershipSettings {
  locations: Array<DealershipLocation>
  team: Array<DealershipMember>
}
