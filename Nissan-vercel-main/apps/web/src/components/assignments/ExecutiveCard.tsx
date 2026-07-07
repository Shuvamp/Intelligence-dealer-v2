import { AlertCircle, CheckCircle, User } from 'lucide-react'

interface ExecutiveCardProps {
  id: string
  name: string
  status: 'active' | 'inactive'
  current_lead_count: number
  max_lead_limit: number
}

export function ExecutiveCard({ name, status, current_lead_count, max_lead_limit }: ExecutiveCardProps) {
  const utilizationPercent = Math.round((current_lead_count / max_lead_limit) * 100)
  const isAtCapacity = current_lead_count >= max_lead_limit
  const isOverCapacity = current_lead_count > max_lead_limit

  return (
    <div className={`p-4 rounded-lg border-2 ${
      isOverCapacity
        ? 'border-red-300 bg-red-50'
        : isAtCapacity
          ? 'border-amber-300 bg-amber-50'
          : 'border-slate-200 bg-white'
    } ${status === 'inactive' ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-brand-bg rounded">
            <User className="w-4 h-4 brand-text" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{name}</h3>
            <p className={`text-xs flex items-center gap-1 ${status === 'active' ? 'text-slate-600' : 'text-gray-500'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-blue-500' : 'bg-gray-400'}`} />
              {status === 'active' ? 'Active' : 'Inactive'}
            </p>
          </div>
        </div>
        {isOverCapacity ? <AlertCircle className="w-4 h-4 text-red-600" /> : <CheckCircle className="w-4 h-4 text-blue-600" />}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-600">Load</span>
          <span className="font-semibold">{current_lead_count}/{max_lead_limit}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              isOverCapacity ? 'bg-red-600' : isAtCapacity ? 'bg-amber-600' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 text-right">{utilizationPercent}% utilized</p>
      </div>
    </div>
  )
}
