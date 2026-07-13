import { createFileRoute } from '@tanstack/react-router'
import { BudgetPlannerPage } from '#/components/context-planner/BudgetPlannerPage'

export const Route = createFileRoute('/_authed/context-planner/budget-planner')({
  component: BudgetPlannerPage,
})
