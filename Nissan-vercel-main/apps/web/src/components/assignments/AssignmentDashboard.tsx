'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp, Users, AlertCircle } from 'lucide-react'
import { ExecutiveCard } from './ExecutiveCard'
import { AssignmentHistory } from './AssignmentHistory'
import { NotificationsList } from './NotificationsList'
import {
  fetchDashboardStats,
  fetchExecutives,
  fetchAssignmentHistory,
  fetchNotifications,
  markNotificationRead,
} from '#/lib/assignments'

interface DashboardStats {
  total_executives: number
  total_capacity: number
  current_load: number
  utilization_percent: number
  total_assignments: number
  total_completions: number
  unread_notifications: number
  executives: any[]
}

export function AssignmentDashboard() {
  const [autoRefresh, setAutoRefresh] = useState(true)

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => fetchDashboardStats(),
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 1000,
  })

  const { data: executives, isLoading: executivesLoading } = useQuery({
    queryKey: ['executives'],
    queryFn: () => fetchExecutives(),
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 1000,
  })

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['assignment-history'],
    queryFn: () => fetchAssignmentHistory({ data: 10 }),
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 1000,
  })

  const { data: notifications, isLoading: notificationsLoading, refetch: refetchNotifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications({ data: { unreadOnly: true, limit: 10 } }),
    refetchInterval: autoRefresh ? 3000 : false,
    staleTime: 1000,
  })

  const unreadCount = (notifications as any[])?.filter((n: any) => !n.is_read)?.length || 0

  const handleMarkNotificationRead = async (id: string) => {
    await markNotificationRead({ data: id })
    refetchNotifications()
  }

  if (statsLoading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  const statsData = stats as DashboardStats | undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Assignment Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor lead assignments and executive workload</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span>Auto-refresh</span>
          </label>
        </div>
      </div>

      {/* Stats Cards */}
      {statsData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Total Executives"
            value={statsData.total_executives}
            color="blue"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Current Load"
            value={`${statsData.current_load}/${statsData.total_capacity}`}
            color="indigo"
          />
          <StatCard
            icon={<BarChart3 className="w-5 h-5" />}
            label="Utilization"
            value={`${statsData.utilization_percent}%`}
            color="purple"
          />
          <StatCard
            icon={<AlertCircle className="w-5 h-5" />}
            label="Unread Notifications"
            value={unreadCount}
            color="orange"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Executives */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <h2 className="text-xl font-semibold mb-4">Sales Executives</h2>
            {executivesLoading ? (
              <div className="text-center py-8 text-gray-500">Loading executives...</div>
            ) : !executives || executives.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No executives found</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(executives as any[]).map((exec: any) => (
                  <ExecutiveCard
                    key={exec.id}
                    id={exec.id}
                    name={exec.name}
                    status={exec.status}
                    current_lead_count={exec.current_lead_count}
                    max_lead_limit={exec.max_lead_limit}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Assignment History */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Recent Assignments</h2>
            <div className="bg-white rounded-lg border p-4">
              <AssignmentHistory assignments={(history as any[]) || []} isLoading={historyLoading} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Notifications */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Notifications</h2>
            <div className="bg-white rounded-lg border p-4 max-h-[500px] overflow-y-auto">
              <NotificationsList
                notifications={(notifications as any[]) || []}
                isLoading={notificationsLoading}
                onMarkRead={handleMarkNotificationRead}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: any) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${colorClasses[color as keyof typeof colorClasses]}`}>
        {icon}
      </div>
      <p className="text-sm text-gray-600">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}
