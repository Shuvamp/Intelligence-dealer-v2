import { createFileRoute } from '@tanstack/react-router'
import { ContextPlannerPage } from '#/components/context-planner/ContextPlannerPage'

export const Route = createFileRoute('/_authed/context-planner/')({
  component: ContextPlannerPage,
})
