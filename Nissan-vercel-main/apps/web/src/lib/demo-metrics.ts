// PRESENTATIONAL DEMO DATA — not from the database.
// These numbers/insights belong to module domains (Leads, Campaigns, Intelligence)
// that ship in Phase 2. They are centralized here so each one becomes a real query
// later without touching dashboard components. Anything sourced from the spine
// (customers, notifications, audit_logs, tenant branding) is REAL and lives elsewhere.

export interface HeroMetric {
  key: string
  label: string
  value: string
  sublabel: string
  tone: 'brand' | 'amber' | 'emerald' | 'sky' | 'neutral'
  trend?: string
}

// `customers` is replaced at runtime with the real count from the DB.
export const heroMetrics: Array<HeroMetric> = [
  { key: 'hot', label: 'Hot Leads', value: '18', sublabel: 'awaiting action', tone: 'brand', trend: '+5 today' },
  { key: 'testdrives', label: 'Test Drives Today', value: '3', sublabel: '2 pending confirm', tone: 'amber' },
  { key: 'campaigns', label: 'Campaigns Scheduled', value: '2', sublabel: 'this week', tone: 'sky' },
  { key: 'pipeline', label: 'Revenue Pipeline', value: '₹1.8 Cr', sublabel: 'across 41 deals', tone: 'emerald', trend: '+12% MoM' },
  { key: 'customers', label: 'Customers', value: '—', sublabel: 'in your dealership', tone: 'neutral' },
]

export interface AiInsight {
  text: string
  source: string
  intent: 'opportunity' | 'risk' | 'action'
}

export const aiInsights: Array<AiInsight> = [
  { text: '5 hot leads have pending follow-ups older than 48 hours.', source: 'Follow-up Advisor', intent: 'risk' },
  { text: 'SUV demand is rising in Villupuram — enquiries up 23% this week.', source: 'Demand Signal', intent: 'opportunity' },
  { text: 'The Magnite campaign generated 42% of this month’s leads.', source: 'Lead Scorer', intent: 'opportunity' },
  { text: 'Recommend launching a weekend SUV campaign before month-end.', source: 'Campaign Planner', intent: 'action' },
]

export const todaysFocus =
  'You have 18 hot leads and 3 test drives today. Magnite is your strongest channel — keep the momentum.'
