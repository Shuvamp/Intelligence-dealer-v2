import { createFileRoute, redirect } from '@tanstack/react-router'

// Connected Channels (now "Channels") was promoted to a top-level Workspace page
// at /channels. This route is kept only to redirect old deep links
// (bookmarks, historical OAuth return URLs) to the new location, preserving
// the ?connected=/?error= search params the OAuth flow relies on.
export const Route = createFileRoute('/_authed/marketing/connected-channels')({
  validateSearch: (search: Record<string, unknown>) => ({
    connected: (search.connected as string) ?? undefined,
    error: (search.error as string) ?? undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/channels', search })
  },
})
