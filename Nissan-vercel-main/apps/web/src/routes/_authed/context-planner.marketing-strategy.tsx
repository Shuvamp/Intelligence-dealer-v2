import { createFileRoute } from '@tanstack/react-router'
import { MarketingStrategyPage } from '#/components/context-planner/MarketingStrategyPage'

export const Route = createFileRoute('/_authed/context-planner/marketing-strategy')({
  component: MarketingStrategyPage,
})
