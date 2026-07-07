import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { getContext } from './integrations/tanstack-query/root-provider'

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    // Preload routes on hover/touch intent.
    defaultPreload: 'intent',
    // Reuse preloaded loader data for 30s instead of refetching on click — this is
    // what makes hovering then clicking a nav item feel instant.
    defaultPreloadStaleTime: 30_000,
    // Keep loader results cached for 60s so back/forward navigation is instant.
    defaultStaleTime: 60_000,
    // Show the pending UI quickly and keep the old page visible briefly to avoid flicker.
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
