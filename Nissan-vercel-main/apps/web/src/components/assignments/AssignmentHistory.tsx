import { Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Assignment {
  assignment_id: string
  lead_id: string
  customer_name?: string | null
  vehicle?: string | null
  executive_name: string
  executive_id: string
  score: 'hot' | 'warm' | 'cold'
  assigned_at: string
}

interface AssignmentHistoryProps {
  assignments: Assignment[]
  isLoading?: boolean
}

const scoreColors = {
  hot: 'bg-red-100 text-red-800 border border-red-300',
  warm: 'bg-amber-100 text-amber-800 border border-amber-300',
  cold: 'bg-blue-100 text-blue-800 border border-blue-300',
}

export function AssignmentHistory({ assignments, isLoading }: AssignmentHistoryProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Loading assignments...</div>
  }

  if (!assignments || assignments.length === 0) {
    return <div className="text-center py-8 text-gray-500">No assignments yet</div>
  }

  return (
    <div className="space-y-2">
      {assignments.map(assignment => (
        <div key={assignment.assignment_id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
          <div className="pt-1">
            <Clock className="w-4 h-4 text-gray-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">{assignment.customer_name ?? 'Lead'}</p>
                <p className="text-xs text-gray-600">
                  Assigned to <span className="font-semibold">{assignment.executive_name}</span>
                  {assignment.vehicle ? <span className="text-gray-400"> · {assignment.vehicle}</span> : null}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${scoreColors[assignment.score]}`}>
                {assignment.score.charAt(0).toUpperCase() + assignment.score.slice(1)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {formatDistanceToNow(new Date(assignment.assigned_at), { addSuffix: true })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
