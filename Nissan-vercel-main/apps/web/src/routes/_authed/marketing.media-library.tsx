import { useState, useRef, useEffect, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { getMediaAssets, deleteAsset, setAssetCampaignSelected } from '#/lib/marketing'
import type { MediaAsset } from '#/lib/types'
import { AssetUploadDialog } from '#/components/marketing/AssetUploadDialog'
import { AssetDetailDrawer } from '#/components/marketing/AssetDetailDrawer'
import {
  Upload, Grid3X3, List, FileText, Search, Trash2,
  Download, Star, Boxes, Car, Palette, Layers, Sparkles,
  Clock, Heart, Layout, ChevronRight, Copy, Check, Eye, RotateCcw,
  SlidersHorizontal, FileStack,
} from 'lucide-react'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_authed/marketing/media-library')({
  loader: async () => ({ assets: await getMediaAssets({ data: {} }) }),
  component: MediaLibrary,
})

type AssetType = 'vehicle' | 'logo' | 'background' | 'brand_asset'
type SortKey = 'newest' | 'oldest' | 'name'
type View =
  | { kind: 'all' }
  | { kind: 'type'; type: AssetType }
  | { kind: 'vehicle'; vehicle: string }
  | { kind: 'recent' }
  | { kind: 'favorites' }
  | { kind: 'trash' }

type PendingFile = { file_b64: string; filename: string; file_size: number }

const TYPE_META: Record<AssetType, { label: string; tone: string; badge: string; icon: React.ReactNode }> = {
  vehicle: {
    label: 'Vehicle',
    tone: 'text-[var(--brand)]',
    badge: 'bg-[color-mix(in_oklab,var(--brand)_14%,transparent)] text-[var(--brand)]',
    icon: <Car className="h-4 w-4" />,
  },
  logo: { label: 'Logo', tone: 'text-sky-600', badge: 'bg-sky-50 text-sky-700', icon: <Palette className="h-4 w-4" /> },
  background: { label: 'Background', tone: 'text-violet-600', badge: 'bg-violet-50 text-violet-700', icon: <Layers className="h-4 w-4" /> },
  brand_asset: { label: 'Brand Asset', tone: 'text-amber-600', badge: 'bg-amber-50 text-amber-700', icon: <Sparkles className="h-4 w-4" /> },
}

const FAV_KEY = 'adip.media.favorites'

function fmtBytes(n?: number | null) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function isImage(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(url)
}

function MediaLibrary() {
  const { assets: initialAssets } = Route.useLoaderData()

  const [assets, setAssets] = useState<MediaAsset[]>(initialAssets)
  const [trashed, setTrashed] = useState<MediaAsset[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>({ kind: 'all' })
  const [sort, setSort] = useState<SortKey>('newest')
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all')
  const [vehicleFilter, setVehicleFilter] = useState<string>('all')

  const [selected, setSelected] = useState<string[]>([])
  // Campaign-planner selection — DB-backed (marketing_assets.campaign_selected),
  // tenant-shared. Seeded from the loaded rows; toggles persist to Supabase.
  const [campaignSel, setCampaignSel] = useState<Set<string>>(
    () => new Set(initialAssets.filter((a) => a.campaign_selected).map((a) => a.id)),
  )
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [detail, setDetail] = useState<MediaAsset | null>(null)
  const [dragging, setDragging] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  // ---- Favorites persistence ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY)
      if (raw) setFavorites(new Set(JSON.parse(raw)))
    } catch { /* ignore */ }
  }, [])
  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  // ---- Campaign selection (fed to the campaign planner, persisted to Supabase) ----
  function toggleCampaign(id: string) {
    const selecting = !campaignSel.has(id)
    setCampaignSel((prev) => {
      const next = new Set(prev)
      selecting ? next.add(id) : next.delete(id)
      return next
    })
    // Persist; revert the optimistic toggle on failure.
    setAssetCampaignSelected({ data: { assetId: id, selected: selecting } }).catch(() => {
      setCampaignSel((prev) => {
        const next = new Set(prev)
        selecting ? next.delete(id) : next.add(id)
        return next
      })
    })
  }
  function clearCampaign() {
    const ids = [...campaignSel]
    setCampaignSel(new Set())
    ids.forEach((id) => { void setAssetCampaignSelected({ data: { assetId: id, selected: false } }).catch(() => {}) })
  }
  function dropFromCampaign(ids: string[]) {
    // Row is being trashed/deleted — just drop from the local set (flag goes with the row).
    setCampaignSel((prev) => new Set([...prev].filter((x) => !ids.includes(x))))
  }

  // ---- Derived data ----
  const vehicles = useMemo(
    () => [...new Set(assets.filter((a) => a.vehicle).map((a) => a.vehicle as string))].sort(),
    [assets],
  )
  const recentCount = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5
    return assets.filter((a) => a.created_at && new Date(a.created_at).getTime() > weekAgo).length
  }, [assets])
  const typeCounts = useMemo(() => {
    const c: Record<AssetType, number> = { vehicle: 0, logo: 0, background: 0, brand_asset: 0 }
    for (const a of assets) c[a.asset_type]++
    return c
  }, [assets])

  // ---- View → base set ----
  const base = useMemo(() => {
    if (view.kind === 'trash') return trashed
    let list = assets
    if (view.kind === 'type') list = list.filter((a) => a.asset_type === view.type)
    else if (view.kind === 'vehicle') list = list.filter((a) => a.vehicle === view.vehicle)
    else if (view.kind === 'favorites') list = list.filter((a) => favorites.has(a.id))
    else if (view.kind === 'recent') {
      const weekAgo = Date.now() - 7 * 864e5
      list = list.filter((a) => a.created_at && new Date(a.created_at).getTime() > weekAgo)
    }
    return list
  }, [assets, trashed, view, favorites])

  const filtered = useMemo(() => {
    let list = base
    if (typeFilter !== 'all') list = list.filter((a) => a.asset_type === typeFilter)
    if (vehicleFilter !== 'all') list = list.filter((a) => a.vehicle === vehicleFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.vehicle?.toLowerCase().includes(q) ||
          a.sub_category?.toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else sorted.sort((a, b) => {
      const da = new Date(a.created_at || 0).getTime()
      const db = new Date(b.created_at || 0).getTime()
      return sort === 'newest' ? db - da : da - db
    })
    return sorted
  }, [base, typeFilter, vehicleFilter, search, sort])

  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  // ---- Upload ----
  function ingestFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1] ?? ''
      setPendingFile({ file_b64: b64, filename: file.name, file_size: file.size })
      setUploadOpen(true)
    }
    reader.readAsDataURL(file)
  }
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) ingestFile(file)
    e.target.value = ''
  }
  function onUploaded(asset: MediaAsset) {
    setAssets((prev) => [asset, ...prev])
  }

  // ---- Drag & drop ----
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files.item(0)
    if (file) ingestFile(file)
  }

  // ---- Soft delete → trash; permanent delete from trash ----
  function softDelete(ids: string[]) {
    const moving = assets.filter((a) => ids.includes(a.id))
    setTrashed((t) => [...moving, ...t])
    setAssets((prev) => prev.filter((a) => !ids.includes(a.id)))
    setSelected((s) => s.filter((x) => !ids.includes(x)))
    dropFromCampaign(ids)
    if (detail && ids.includes(detail.id)) setDetail(null)
  }
  function restore(ids: string[]) {
    const back = trashed.filter((a) => ids.includes(a.id))
    setAssets((prev) => [...back, ...prev])
    setTrashed((t) => t.filter((a) => !ids.includes(a.id)))
    setSelected((s) => s.filter((x) => !ids.includes(x)))
  }
  async function purge(ids: string[]) {
    setDeleting(true)
    try {
      const list = trashed.filter((a) => ids.includes(a.id))
      await Promise.all(list.map((a) => deleteAsset({ data: { assetId: a.id, file_url: a.file_url } })))
      setTrashed((t) => t.filter((a) => !ids.includes(a.id)))
      setSelected((s) => s.filter((x) => !ids.includes(x)))
    } finally {
      setDeleting(false)
    }
  }

  function copyUrl(asset: MediaAsset) {
    navigator.clipboard.writeText(asset.file_url).then(() => {
      setCopiedId(asset.id)
      setTimeout(() => setCopiedId((c) => (c === asset.id ? null : c)), 1500)
    })
  }

  const inTrash = view.kind === 'trash'

  return (
    <div className="flex h-full overflow-hidden app-canvas">
      <AssetUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} pendingFile={pendingFile} onUploaded={onUploaded} />
      <AssetDetailDrawer
        asset={detail}
        onClose={() => setDetail(null)}
        onDelete={(a) => softDelete([a.id])}
        isFavorite={detail ? favorites.has(detail.id) : false}
        onToggleFavorite={toggleFavorite}
      />
      <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" className="hidden" onChange={onFileChange} />

      {/* ───────── Sidebar ───────── */}
      <aside className="w-60 shrink-0 border-r border-border bg-white/80 backdrop-blur-sm flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-[10px] brand-bg flex items-center justify-center shadow-card">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[13px] font-bold tracking-tight text-foreground leading-none">Media Library</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Digital Asset Manager</p>
            </div>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all assets…"
              className="w-full h-9 pl-8 pr-2.5 rounded-[10px] border border-border bg-white text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand)_18%,transparent)] transition"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-0.5">
          <NavItem active={view.kind === 'all'} onClick={() => setView({ kind: 'all' })} icon={<Boxes className="h-4 w-4" />} label="All Assets" count={assets.length} />
          <NavItem active={view.kind === 'recent'} onClick={() => setView({ kind: 'recent' })} icon={<Clock className="h-4 w-4" />} label="Recently Uploaded" count={recentCount} />
          <NavItem active={view.kind === 'favorites'} onClick={() => setView({ kind: 'favorites' })} icon={<Heart className="h-4 w-4" />} label="Favorites" count={favorites.size} />

          <SectionLabel>Library</SectionLabel>
          {(['vehicle', 'logo', 'background', 'brand_asset'] as AssetType[]).map((t) => (
            <NavItem
              key={t}
              active={view.kind === 'type' && view.type === t}
              onClick={() => setView({ kind: 'type', type: t })}
              icon={<span className={TYPE_META[t].tone}>{TYPE_META[t].icon}</span>}
              label={t === 'vehicle' ? 'Vehicles' : t === 'logo' ? 'Logos' : t === 'background' ? 'Backgrounds' : 'Brand Assets'}
              count={typeCounts[t]}
            />
          ))}
          <NavItem active={false} onClick={() => setView({ kind: 'all' })} icon={<Layout className="h-4 w-4 text-emerald-600" />} label="Campaign Assets" count={typeCounts.brand_asset} muted />

          {vehicles.length > 0 && (
            <>
              <SectionLabel>Vehicles</SectionLabel>
              {vehicles.map((v) => (
                <NavItem
                  key={v}
                  active={view.kind === 'vehicle' && view.vehicle === v}
                  onClick={() => setView({ kind: 'vehicle', vehicle: v })}
                  icon={<Car className="h-4 w-4 text-muted-foreground" />}
                  label={v}
                  count={assets.filter((a) => a.vehicle === v).length}
                />
              ))}
            </>
          )}

          <div className="pt-1.5 mt-1.5 border-t border-border">
            <NavItem active={view.kind === 'trash'} onClick={() => setView({ kind: 'trash' })} icon={<Trash2 className="h-4 w-4" />} label="Trash" count={trashed.length} />
          </div>
        </nav>
      </aside>

      {/* ───────── Main ───────── */}
      <div
        className="flex-1 flex flex-col overflow-hidden relative"
        onDragOver={(e) => { e.preventDefault(); if (!inTrash) setDragging(true) }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={onDrop}
      >
        {/* Drag overlay */}
        {dragging && !inTrash && (
          <div className="absolute inset-0 z-40 m-4 rounded-[24px] border-2 border-dashed border-[var(--brand)] bg-[color-mix(in_oklab,var(--brand)_8%,white)] backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
            <div className="h-14 w-14 rounded-2xl brand-bg flex items-center justify-center mb-3 shadow-float">
              <Upload className="h-6 w-6" />
            </div>
            <p className="text-[15px] font-bold text-foreground">Drop to upload</p>
            <p className="text-[12px] text-muted-foreground">Release the file to add it to your library</p>
          </div>
        )}

        {/* Hero header */}
        <header className="shrink-0 px-6 pt-5 pb-4 border-b border-border bg-white/70 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="kicker text-muted-foreground/70">Marketing · Assets</p>
              <h1 className="text-[24px] font-bold tracking-tight text-foreground mt-0.5">
                {view.kind === 'trash' ? 'Trash' : view.kind === 'favorites' ? 'Favorites' : view.kind === 'recent' ? 'Recently Uploaded' : view.kind === 'type' ? `${TYPE_META[view.type].label}s` : view.kind === 'vehicle' ? view.vehicle : 'Media Library'}
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
              </p>
            </div>
            {!inTrash && (
              <div className="flex items-center gap-2">
<button
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 h-10 rounded-[12px] border border-border bg-white px-3.5 text-[13px] font-semibold text-foreground hover:bg-muted/40 transition"
                >
                  <FileStack className="h-4 w-4 text-muted-foreground" /> Bulk Import
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 h-10 rounded-[12px] brand-bg px-4 text-[13px] font-semibold hover:opacity-90 transition shadow-card"
                >
                  <Upload className="h-4 w-4" /> Upload
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Toolbar */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-3 border-b border-border bg-white/50 backdrop-blur-sm flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground num">{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</span>

            {inTrash && selected.length > 0 && (
              <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
                <span className="text-[12px] font-semibold text-[var(--brand)]">{selected.length} selected</span>
                <button onClick={() => setSelected([])} className="rounded-[8px] border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted/40 transition">Clear</button>
                <button onClick={() => restore(selected)} className="inline-flex items-center gap-1 rounded-[8px] border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted/40 transition">
                  <RotateCcw className="h-3 w-3" /> Restore
                </button>
                <button onClick={() => purge(selected)} disabled={deleting} className="inline-flex items-center gap-1 rounded-[8px] border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-[var(--brand)] hover:bg-red-100 transition disabled:opacity-50">
                  <Trash2 className="h-3 w-3" /> {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            )}
            {!inTrash && campaignSel.size > 0 && (
              <div className="flex items-center gap-2 ml-2 pl-3 border-l border-border">
                <span className="text-[12px] font-semibold text-[var(--brand)]">{campaignSel.size} selected for campaigns</span>
                <button onClick={clearCampaign} className="rounded-[8px] border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted/40 transition">Clear</button>
                <button onClick={() => softDelete([...campaignSel])} className="inline-flex items-center gap-1 rounded-[8px] border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-[var(--brand)] hover:bg-red-100 transition">
                  <Trash2 className="h-3 w-3" /> Move to Trash
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!inTrash && (
              <>
                <FilterSelect icon={<SlidersHorizontal className="h-3.5 w-3.5" />} value={typeFilter} onChange={(v) => setTypeFilter(v as AssetType | 'all')}>
                  <option value="all">All types</option>
                  <option value="vehicle">Vehicles</option>
                  <option value="logo">Logos</option>
                  <option value="background">Backgrounds</option>
                  <option value="brand_asset">Brand Assets</option>
                </FilterSelect>
                {vehicles.length > 0 && (
                  <FilterSelect icon={<Car className="h-3.5 w-3.5" />} value={vehicleFilter} onChange={setVehicleFilter}>
                    <option value="all">All vehicles</option>
                    {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
                  </FilterSelect>
                )}
                <FilterSelect value={sort} onChange={(v) => setSort(v as SortKey)}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name">Name A–Z</option>
                </FilterSelect>
              </>
            )}
            <div className="flex bg-muted border border-border rounded-[10px] p-0.5">
              <button onClick={() => setLayout('grid')} className={cn('p-1.5 rounded-[8px] transition-all', layout === 'grid' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground')}>
                <Grid3X3 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setLayout('list')} className={cn('p-1.5 rounded-[8px] transition-all', layout === 'list' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground')}>
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <EmptyState view={view} onUpload={() => fileRef.current?.click()} />
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-4">
              {!inTrash && view.kind === 'all' && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="aspect-[4/3] rounded-[18px] border-2 border-dashed border-border bg-white/60 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--brand)] hover:bg-[color-mix(in_oklab,var(--brand)_5%,white)] transition-all group"
                >
                  <div className="h-10 w-10 rounded-[12px] bg-muted group-hover:brand-bg flex items-center justify-center transition-colors">
                    <Upload className="h-5 w-5 text-muted-foreground group-hover:text-white transition-colors" />
                  </div>
                  <p className="text-[11px] text-muted-foreground group-hover:text-[var(--brand)] font-semibold text-center transition-colors">Upload new asset</p>
                </button>
              )}
              {filtered.map((asset, i) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  index={i}
                  selected={inTrash ? selected.includes(asset.id) : campaignSel.has(asset.id)}
                  favorite={favorites.has(asset.id)}
                  copied={copiedId === asset.id}
                  inTrash={inTrash}
                  onToggleSel={() => (inTrash ? toggleSel(asset.id) : toggleCampaign(asset.id))}
                  onOpen={() => setDetail(asset)}
                  onCopy={() => copyUrl(asset)}
                  onFav={() => toggleFavorite(asset.id)}
                  onDelete={() => (inTrash ? purge([asset.id]) : softDelete([asset.id]))}
                  onRestore={() => restore([asset.id])}
                />
              ))}
            </div>
          ) : (
            <ListView
              assets={filtered}
              selected={inTrash ? selected : [...campaignSel]}
              favorites={favorites}
              inTrash={inTrash}
              onToggleSel={inTrash ? toggleSel : toggleCampaign}
              onOpen={setDetail}
              onFav={toggleFavorite}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ───────────────── Sub-components ───────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-muted-foreground/70 px-2.5 pt-3 pb-1 uppercase tracking-wider">{children}</p>
}

function NavItem({ active, onClick, icon, label, count, muted }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-left transition-all group',
        active ? 'bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] text-[var(--brand)]' : 'text-foreground hover:bg-muted/50',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-[var(--brand)]' : muted ? 'text-muted-foreground' : '')}>{icon}</span>
      <span className="text-[12px] font-semibold flex-1 truncate">{label}</span>
      <span className={cn('text-[10px] font-semibold num px-1.5 py-0.5 rounded-md', active ? 'bg-white/70 text-[var(--brand)]' : 'text-muted-foreground bg-muted/60 group-hover:bg-white')}>{count}</span>
    </button>
  )
}

function FilterSelect({ icon, value, onChange, children }: {
  icon?: React.ReactNode; value: string; onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <div className="relative inline-flex items-center">
      {icon && <span className="absolute left-2.5 text-muted-foreground pointer-events-none">{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-9 rounded-[10px] border border-border bg-white text-[12px] font-semibold text-foreground focus:outline-none focus:border-[var(--brand)] transition appearance-none pr-7',
          icon ? 'pl-8' : 'pl-3',
        )}
      >
        {children}
      </select>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground absolute right-2 rotate-90 pointer-events-none" />
    </div>
  )
}

function AssetCard({ asset, index, selected, favorite, copied, inTrash, onToggleSel, onOpen, onCopy, onFav, onDelete, onRestore }: {
  asset: MediaAsset; index: number; selected: boolean; favorite: boolean; copied: boolean; inTrash: boolean
  onToggleSel: () => void; onOpen: () => void; onCopy: () => void; onFav: () => void; onDelete: () => void; onRestore: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const image = isImage(asset.file_url)
  const meta = TYPE_META[asset.asset_type]

  return (
    <div
      className={cn(
        'group relative rounded-[18px] border bg-white overflow-hidden transition-all duration-200 fade-up',
        selected ? 'border-2 border-[var(--brand)] shadow-float' : 'border-border hover:shadow-float hover:-translate-y-0.5',
      )}
      style={{ animationDelay: `${Math.min(index * 28, 320)}ms` }}
    >
      {/* Selection checkbox */}
      <button
        onClick={onToggleSel}
        className={cn(
          'absolute top-2.5 left-2.5 z-20 h-5 w-5 rounded-[6px] border-2 flex items-center justify-center transition-all',
          selected ? 'bg-[var(--brand)] border-[var(--brand)]' : 'bg-white/90 border-white shadow-sm opacity-0 group-hover:opacity-100',
        )}
      >
        {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </button>

      {/* Favorite star */}
      {!inTrash && (
        <button
          onClick={onFav}
          className={cn(
            'absolute top-2.5 right-2.5 z-20 h-7 w-7 rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
            favorite ? 'bg-white/90 text-amber-500 opacity-100' : 'bg-white/80 text-muted-foreground opacity-0 group-hover:opacity-100',
          )}
          title={favorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star className={cn('h-3.5 w-3.5', favorite && 'fill-amber-400')} />
        </button>
      )}

      {/* Thumbnail */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        className="block w-full aspect-[4/3] bg-[radial-gradient(circle_at_30%_20%,#f8fafc,#eef1f5)] relative overflow-hidden cursor-pointer"
      >
        {image ? (
          <>
            {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" />}
            <img
              src={asset.file_url}
              alt={asset.name}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className={cn('w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.06]', loaded ? 'opacity-100' : 'opacity-0')}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileText className={cn('h-12 w-12', meta.tone)} />
          </div>
        )}

        {/* Hover action bar */}
        <div className="absolute inset-x-0 bottom-0 p-2 flex items-center justify-center gap-1.5 bg-gradient-to-t from-slate-900/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <ActionPill title="Preview" onClick={(e) => { e.stopPropagation(); onOpen() }}><Eye className="h-3.5 w-3.5" /></ActionPill>
          {inTrash ? (
            <>
              <ActionPill title="Restore" onClick={(e) => { e.stopPropagation(); onRestore() }}><RotateCcw className="h-3.5 w-3.5" /></ActionPill>
              <ActionPill title="Delete forever" tone="danger" onClick={(e) => { e.stopPropagation(); onDelete() }}><Trash2 className="h-3.5 w-3.5" /></ActionPill>
            </>
          ) : (
            <>
              <ActionPill title="Download" onClick={(e) => { e.stopPropagation() }} asChild>
                <a href={asset.file_url} download={asset.name} onClick={(e) => e.stopPropagation()}><Download className="h-3.5 w-3.5" /></a>
              </ActionPill>
              <ActionPill title={copied ? 'Copied!' : 'Copy URL'} onClick={(e) => { e.stopPropagation(); onCopy() }}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              </ActionPill>
              <ActionPill title="Delete" tone="danger" onClick={(e) => { e.stopPropagation(); onDelete() }}><Trash2 className="h-3.5 w-3.5" /></ActionPill>
            </>
          )}
        </div>
      </div>

      {/* Caption */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', meta.badge)}>
            {meta.label}
          </span>
          {asset.vehicle && <span className="text-[9px] font-semibold text-muted-foreground truncate">{asset.vehicle}</span>}
        </div>
        <p className="text-[12px] font-semibold text-foreground truncate" title={asset.name}>{asset.name}</p>
        <p className="text-[10px] text-muted-foreground num mt-0.5">
          {fmtBytes(asset.file_size)} · {asset.created_at ? new Date(asset.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
        </p>
      </div>
    </div>
  )
}

function ActionPill({ children, title, onClick, tone, asChild }: {
  children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void; tone?: 'danger'; asChild?: boolean
}) {
  const cls = cn(
    'h-8 w-8 rounded-[10px] flex items-center justify-center backdrop-blur-sm transition-all hover:scale-110',
    tone === 'danger' ? 'bg-white/90 text-[var(--brand)] hover:bg-white' : 'bg-white/90 text-foreground hover:bg-white',
  )
  if (asChild) return <span className={cls} title={title} onClick={onClick}>{children}</span>
  return <button className={cls} title={title} onClick={onClick}>{children}</button>
}

function ListView({ assets, selected, favorites, inTrash, onToggleSel, onOpen, onFav }: {
  assets: MediaAsset[]; selected: string[]; favorites: Set<string>; inTrash: boolean
  onToggleSel: (id: string) => void; onOpen: (a: MediaAsset) => void; onFav: (id: string) => void
}) {
  return (
    <div className="rounded-[18px] border border-border bg-white overflow-hidden shadow-card">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/40 border-b border-border">
            <th className="w-10 px-4 py-3" />
            {['Asset', 'Type', 'Vehicle', 'Size', 'Uploaded', ''].map((h, i) => (
              <th key={i} className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const image = isImage(asset.file_url)
            const meta = TYPE_META[asset.asset_type]
            return (
              <tr key={asset.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors group">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.includes(asset.id)} onChange={() => onToggleSel(asset.id)} className="h-3.5 w-3.5 accent-[var(--brand)]" />
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => onOpen(asset)} className="flex items-center gap-3 text-left">
                    <div className="h-11 w-11 rounded-[10px] bg-muted border border-border overflow-hidden flex items-center justify-center shrink-0">
                      {image ? (
                        <img src={asset.file_url} alt={asset.name} loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      ) : <FileText className={cn('h-5 w-5', meta.tone)} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-foreground truncate">{asset.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{asset.sub_category || asset.file_url}</p>
                    </div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', meta.badge)}>{meta.label}</span>
                </td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground">{asset.vehicle ?? '—'}</td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground num">{fmtBytes(asset.file_size)}</td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground num">{asset.created_at ? new Date(asset.created_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!inTrash && (
                      <button onClick={() => onFav(asset.id)} className={cn('h-7 w-7 rounded-[8px] flex items-center justify-center hover:bg-muted transition', favorites.has(asset.id) ? 'text-amber-500' : 'text-muted-foreground')}>
                        <Star className={cn('h-3.5 w-3.5', favorites.has(asset.id) && 'fill-amber-400')} />
                      </button>
                    )}
                    <button onClick={() => onOpen(asset)} className="h-7 w-7 rounded-[8px] flex items-center justify-center text-muted-foreground hover:bg-muted transition">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ view, onUpload }: { view: View; onUpload: () => void }) {
  const map: Record<View['kind'], { icon: React.ReactNode; title: string; body: string; cta: boolean }> = {
    all: { icon: <Boxes className="h-9 w-9" />, title: 'Your library is empty', body: 'Upload Nissan vehicle photography, logos, backgrounds, and brand assets to build your DAM.', cta: true },
    type: { icon: <Layers className="h-9 w-9" />, title: 'Nothing here yet', body: 'No assets of this type. Upload one to get started.', cta: true },
    vehicle: { icon: <Car className="h-9 w-9" />, title: 'No assets for this vehicle', body: 'Upload photography tagged to this model.', cta: true },
    recent: { icon: <Clock className="h-9 w-9" />, title: 'Nothing uploaded recently', body: 'Assets added in the last 7 days will appear here.', cta: true },
    favorites: { icon: <Heart className="h-9 w-9" />, title: 'No favorites yet', body: 'Star assets you use often to find them fast.', cta: false },
    trash: { icon: <Trash2 className="h-9 w-9" />, title: 'Trash is empty', body: 'Deleted assets land here and can be restored.', cta: false },
  }
  const e = map[view.kind]
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center fade-up">
      <div className="h-20 w-20 rounded-[24px] bg-gradient-to-br from-muted to-white border border-border flex items-center justify-center text-muted-foreground/50 shadow-card mb-5">
        {e.icon}
      </div>
      <h3 className="text-[17px] font-bold text-foreground">{e.title}</h3>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-sm">{e.body}</p>
      {e.cta && (
        <button onClick={onUpload} className="inline-flex items-center gap-2 h-10 rounded-[12px] brand-bg px-5 text-[13px] font-semibold hover:opacity-90 transition mt-5 shadow-card">
          <Upload className="h-4 w-4" /> Upload your first asset
        </button>
      )}
    </div>
  )
}
