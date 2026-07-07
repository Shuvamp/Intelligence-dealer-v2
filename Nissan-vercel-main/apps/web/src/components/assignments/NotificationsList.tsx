import { Bell, Check, AlertCircle, CheckCircle, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Notification {
  notification_id: string
  lead_id?: string
  executive_id?: string
  event_type: string
  message: string
  is_read: boolean
  created_at: string
}

interface NotificationsListProps {
  notifications: Notification[]
  isLoading?: boolean
  onMarkRead?: (notificationId: string) => void
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'lead_assigned':
      return <Zap className="w-4 h-4 text-blue-600" />
    case 'lead_completed':
      return <CheckCircle className="w-4 h-4 text-green-600" />
    case 'executive_deactivated':
      return <AlertCircle className="w-4 h-4 text-orange-600" />
    case 'assignment_failed':
      return <AlertCircle className="w-4 h-4 text-red-600" />
    default:
      return <Bell className="w-4 h-4 text-gray-600" />
  }
}

function getEventLabel(eventType: string) {
  switch (eventType) {
    case 'lead_assigned':
      return 'Lead Assigned'
    case 'lead_completed':
      return 'Lead Completed'
    case 'executive_deactivated':
      return 'Executive Deactivated'
    case 'assignment_failed':
      return 'Assignment Failed'
    default:
      return eventType
  }
}

export function NotificationsList({ notifications, isLoading, onMarkRead }: NotificationsListProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Loading notifications...</div>
  }

  if (!notifications || notifications.length === 0) {
    return (
      <div className="text-center py-8">
        <Bell className="w-12 h-12 mx-auto text-gray-300 mb-2" />
        <p className="text-gray-500">No notifications</p>
      </div>
    )
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <div className="space-y-2">
      {unreadCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded text-xs font-medium">
          {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
        </div>
      )}

      {notifications.map(notif => (
        <div
          key={notif.notification_id}
          className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
            notif.is_read ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-200'
          }`}
        >
          <div className="pt-1 flex-shrink-0">{getEventIcon(notif.event_type)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-700">{getEventLabel(notif.event_type)}</p>
                <p className="text-sm text-gray-600 mt-1">{notif.message}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                </p>
              </div>
              {!notif.is_read && onMarkRead && (
                <button
                  onClick={() => onMarkRead(notif.notification_id)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Mark as read"
                >
                  <Check className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
