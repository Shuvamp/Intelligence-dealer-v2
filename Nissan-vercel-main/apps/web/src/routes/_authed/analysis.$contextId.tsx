import { createFileRoute } from '@tanstack/react-router'
import { getContext } from '#/lib/context-planner'
import { AnalysisPage } from '#/components/analysis/AnalysisPage'

export const Route = createFileRoute('/_authed/analysis/$contextId')({
  loader: async ({ params }) => ({
    context: await getContext({ data: { context_id: params.contextId } }),
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { context } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  return <AnalysisPage context={context} tenantId={user.profile.tenant_id} />
}
