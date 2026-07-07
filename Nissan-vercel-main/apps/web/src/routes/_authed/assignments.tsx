import { createFileRoute } from '@tanstack/react-router'
import { AssignmentDashboard } from '#/components/assignments/AssignmentDashboard'

export const Route = createFileRoute('/_authed/assignments')({
  component: AssignmentsPage,
})

function AssignmentsPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AssignmentDashboard />
    </div>
  )
}
