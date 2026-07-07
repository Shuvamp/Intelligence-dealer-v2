import { QueryClient } from '@tanstack/react-query'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays "fresh" for 60s — no refetch on navigation within that window.
        staleTime: 60_000,
        // Keep cached pages in memory for 5 min so back/forward is instant.
        gcTime: 5 * 60_000,
        // Don't hammer the API every time the window regains focus.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  })

  return {
    queryClient,
  }
}
export default function TanstackQueryProvider() {}
