import { useState } from 'react'
import { uploadAsset } from '#/lib/marketing'
import type { MediaAsset } from '#/lib/types'
import { X, Upload } from 'lucide-react'

const ASSET_TYPES = [
  { value: 'vehicle',     label: 'Vehicle Image' },
  { value: 'logo',        label: 'Logo' },
  { value: 'background',  label: 'Background' },
  { value: 'brand_asset', label: 'Brand Asset' },
] as const

const VEHICLES = ['Tekton', 'Magnite', 'Patrol', 'X-Trail', 'Sunny', 'Navara', 'Kicks']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingFile: { file_b64: string; filename: string; file_size: number } | null
  onUploaded: (asset: MediaAsset) => void
}

export function AssetUploadDialog({ open, onOpenChange, pendingFile, onUploaded }: Props) {
  const [name, setName] = useState('')
  const [assetType, setAssetType] = useState<'vehicle' | 'logo' | 'background' | 'brand_asset'>('vehicle')
  const [vehicle, setVehicle] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open || !pendingFile) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Asset name is required'); return }
    if (assetType === 'vehicle' && !vehicle) { setError('Select a vehicle'); return }
    setSaving(true)
    setError(null)
    try {
      const asset = await uploadAsset({
        data: {
          file_b64: pendingFile!.file_b64,
          filename: pendingFile!.filename,
          name: name.trim(),
          asset_type: assetType,
          vehicle: assetType === 'vehicle' ? vehicle : undefined,
          sub_category: subCategory.trim() || undefined,
          file_size: pendingFile!.file_size,
        },
      })
      onUploaded(asset)
      onOpenChange(false)
      setName('')
      setVehicle('')
      setSubCategory('')
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-bold text-foreground">Upload Asset</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-muted/60 transition"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex items-center gap-3 rounded-[12px] bg-muted/30 border border-border px-3.5 py-3">
            <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-foreground truncate">{pendingFile.filename}</p>
              <p className="text-[11px] text-muted-foreground">
                {pendingFile.file_size ? `${(pendingFile.file_size / 1024).toFixed(1)} KB` : 'Ready to upload'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground">Asset Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Magnite Red Studio Shot"
              className="w-full h-9 rounded-[10px] border border-border px-3 text-[12px] text-foreground focus:outline-none focus:border-[#C3002F]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground">Asset Type *</label>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as typeof assetType)}
              className="w-full h-9 rounded-[10px] border border-border px-3 text-[12px] text-foreground focus:outline-none focus:border-[#C3002F] bg-white"
            >
              {ASSET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {assetType === 'vehicle' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-foreground">Vehicle *</label>
              <select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                className="w-full h-9 rounded-[10px] border border-border px-3 text-[12px] text-foreground focus:outline-none focus:border-[#C3002F] bg-white"
              >
                <option value="">Select vehicle...</option>
                {VEHICLES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground">Sub-category (optional)</label>
            <input
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              placeholder="e.g. Studio, Lifestyle, Exterior..."
              className="w-full h-9 rounded-[10px] border border-border px-3 text-[12px] text-foreground focus:outline-none focus:border-[#C3002F]"
            />
          </div>

          {error && (
            <p className="text-[11px] text-[#C3002F] font-medium">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="flex-1 h-9 rounded-[10px] border border-border text-[12px] font-semibold text-foreground hover:bg-muted/40 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-9 rounded-[10px] bg-[#C3002F] text-[12px] font-semibold text-white hover:bg-[#a50027] transition disabled:opacity-50"
            >
              {saving ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
