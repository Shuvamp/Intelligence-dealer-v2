import {
  LayoutDashboard,
  Users,
  Target,
  Megaphone,
  LineChart,
  Sparkles,
  CreditCard,
  Settings,
  BarChart3,
  Compass,
  Link2,
  type LucideIcon,
} from 'lucide-react'
import type { SubscriptionPlan } from '#/lib/types'

export interface NavChild {
  label: string
  to: string
}

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  minPlan: SubscriptionPlan
  group: 'main' | 'system'
  children?: Array<NavChild>
}

// Order tells the platform story: Customer -> Lead -> Campaign -> Insight -> Copilot.
export const NAV_ITEMS: Array<NavItem> = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, minPlan: 'starter', group: 'main' },
  {
    label: 'Context Planner', to: '/context-planner', icon: Compass, minPlan: 'intelligence', group: 'main',
    children: [
      { label: 'Analysis',           to: '/context-planner' },
      { label: 'Marketing Strategy', to: '/context-planner/marketing-strategy' },
      { label: 'Budget Planner',     to: '/context-planner/budget-planner' },
    ],
  },
  { label: 'Customers', to: '/customers', icon: Users, minPlan: 'starter', group: 'main' },
  { label: 'Leads', to: '/leads', icon: Target, minPlan: 'starter', group: 'main' },
  { label: 'Assignments', to: '/assignments', icon: BarChart3, minPlan: 'starter', group: 'main' },
  {
    label: 'Marketing', to: '/marketing/dashboard', icon: Megaphone, minPlan: 'growth', group: 'main',
    children: [
      { label: 'Dashboard',          to: '/marketing/dashboard' },
      { label: 'Campaign Planner',   to: '/marketing/campaign-planner' },
      { label: 'Content Studio',     to: '/marketing/content-studio' },
      { label: 'Publishing',         to: '/marketing/publishing' },
      { label: 'Media Library',      to: '/marketing/media-library' },
    ],
  },
  { label: 'Intelligence', to: '/intelligence', icon: LineChart, minPlan: 'intelligence', group: 'main' },
  { label: 'Channels', to: '/channels', icon: Link2, minPlan: 'intelligence', group: 'main' },
  { label: 'Copilot', to: '/copilot', icon: Sparkles, minPlan: 'intelligence', group: 'main' },
  { label: 'Subscription', to: '/subscription', icon: CreditCard, minPlan: 'starter', group: 'system' },
  { label: 'Settings', to: '/settings', icon: Settings, minPlan: 'starter', group: 'system' },
]

const RANK: Record<SubscriptionPlan, number> = {
  starter: 0,
  growth: 1,
  intelligence: 2,
  enterprise: 3,
}

export function planAllows(plan: SubscriptionPlan, minPlan: SubscriptionPlan) {
  return RANK[plan] >= RANK[minPlan]
}
