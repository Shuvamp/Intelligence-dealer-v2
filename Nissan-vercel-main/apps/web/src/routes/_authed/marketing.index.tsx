import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/marketing/')({
  beforeLoad: () => {
    throw redirect({ to: '/marketing/dashboard', search: {} as any })
  },
})
