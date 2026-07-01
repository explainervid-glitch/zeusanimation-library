import { useState, useRef, useEffect } from 'react'
import {
  PanelRightClose,
  PanelRightOpen,
  Send,
  Sparkles,
  Loader2,
  X,
  Search,
  ImageIcon,
  User,
  Zap,
  BookImage,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import useAISidebarStore from '../../store/useAISidebarStore'
import useAssetStore from '../../store/useAssetStore'

const MIN_WIDTH = 260
const MAX_WIDTH = 560

// ─── TYPE CONFIG ─────────────────────────────────────────────
const TYPE_CONFIG = {
  background:  { label: 'Backgrounds',  Icon: ImageIcon },
  character:   { label: 'Characters',   Icon: User      },
  animation:   { label: 'Animations',   Icon: Zap       },
  inspiration: { label: 'Inspiration',  Icon: BookImage },
  other:       { label: 'Others',       Icon: ImageIcon },
}

// ─── ASSET THUMBNAIL ─────────────────────────────────────────
function AssetThumb({ asset }) {
  const [err, setErr] = useState(false)
  const toUrl = (p) => p ? 'file:///' + p.replace(/\\/g, '/') : null

  // The scanner stores ALL preview files (jpg/jpeg/png/gif/mp4/webm) in
  // mp4_path regardless of actual type — pick <img> vs <video> by extension.
  const previewPath = asset.mp4_path || asset.thumbnail_path || null
  const previewUrl  = toUrl(previewPath)
  const isVideo     = previewPath && /\.(mp4|webm)$/i.test(previewPath)
  const isImage     = previewPath && /\.(jpg|jpeg|png|gif|webp)$/i.test(previewPath)

  if (!err && previewUrl && isVideo) return (
    <video src={previewUrl} muted loop playsInline autoPlay
      onError={() => setErr(true)}
      className="w-full h-full object-cover" />
  )
  if (!err && previewUrl && isImage) return (
    <img src={previewUrl} alt={asset.name}
      onError={() => setErr(true)}
      className="w-full h-full object-cover" />
  )
  return <ImageIcon size={14} className="text-c-text-4" />
}

// ─── RESULT CARD ─────────────────────────────────────────────
function ResultCard({ asset, onNavigate }) {
  const pct = asset.rag_score != null ? Math.round(asset.rag_score * 100) : null

  return (
    <button
      onClick={() => onNavigate(asset)}
      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg
        hover:bg-c-hover border border-transparent hover:border-c-border
        transition-all group"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-md bg-c-raised border border-c-border
        flex items-center justify-center overflow-hidden">
        <AssetThumb asset={asset} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-c-text truncate leading-tight">
          {asset.name || '—'}
        </p>
        <p className="text-[10px] text-c-text-3 truncate mt-0.5">
          {asset.rag_category || ''}
        </p>
      </div>

      {pct != null && (
        <span className={`flex-shrink-0 text-[9px] font-mono px-1 py-0.5 rounded
          ${pct >= 70 ? 'bg-green-500/15 text-green-400'
          : pct >= 40 ? 'bg-yellow-500/15 text-yellow-400'
          : 'bg-c-raised text-c-text-4'}`}>
          {pct}%
        </span>
      )}
    </button>
  )
}

// ─── TYPE GROUP ──────────────────────────────────────────────
function ResultGroup({ type, assets, onNavigate }) {
  const [open, setOpen] = useState(true)
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.other
  const { Icon } = cfg

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-1 py-1
          text-[10px] font-semibold uppercase tracking-wider
          text-c-text-3 hover:text-c-text transition-colors"
      >
        <Icon size={10} />
        <span>{cfg.label}</span>
        <span className="ml-1 text-[9px] font-normal normal-case text-c-text-4">
          ({assets.length})
        </span>
        <span className="ml-auto">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {assets.map(asset => (
            <ResultCard key={asset.id} asset={asset} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── EMPTY STATE ─────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-4">
      <div className="w-12 h-12 rounded-2xl bg-c-accent/10 flex items-center justify-center">
        <Search size={20} className="text-c-accent" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-c-text-2">Semantic Search</p>
      </div>
    </div>
  )
}

// ─── PANEL CONTENT ───────────────────────────────────────────
function AIPanelContent() {
  const {
    ragResults, ragError, ragQuery,
    hasSearched, isLoading, ragSearch, clearChat, toggleSidebar,
  } = useAISidebarStore()

  // Style-only scoping — category selection is NOT required for AI search
  const selectedStyleId = useAssetStore(state => state.selectedStyleId)
  const navigateToAsset = useAssetStore(state => state.navigateToAsset)

  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const styleId  = selectedStyleId ?? null
  const hasStyle = styleId != null

  const handleSearch = async () => {
    if (!input.trim() || isLoading || !hasStyle) return
    await ragSearch(input.trim(), styleId)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch() }
  }

  const handleNavigate = async (asset) => { await navigateToAsset(asset) }

  const totalResults = Object.values(ragResults).reduce((s, a) => s + a.length, 0)
  const typeOrder    = ['background', 'character', 'animation', 'inspiration', 'other']
  const sortedTypes  = Object.keys(ragResults).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b))
  const hasResults   = totalResults > 0

  return (
    <div className="h-full flex flex-col bg-c-surface border-l border-c-border">

      {/* Header — matches Sidebar header exactly */}
      <div className="px-3 py-2.5 border-b border-c-border flex items-center justify-between flex-shrink-0">
        <p className="text-[10px] text-c-text-4 uppercase tracking-widest font-medium">
          AI Search
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="p-1 rounded hover:bg-c-hover text-c-text-3 hover:text-c-text transition-all"
            title="Clear results"
          >
            <X size={14} />
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1 rounded hover:bg-c-hover text-c-text-3 hover:text-c-text transition-all"
            title="Hide AI Search"
          >
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">

        {!hasStyle && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20
            rounded-lg px-2.5 py-2">
            <AlertCircle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-yellow-300">Select a style to scope search.</p>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Loader2 size={18} className="animate-spin text-c-accent" />
            <p className="text-[10px] text-c-text-3">Searching...</p>
          </div>
        )}

        {!isLoading && ragError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
            <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-red-300 font-medium">Search failed</p>
              <p className="text-[9px] text-red-400/70 mt-0.5">{ragError}</p>
            </div>
          </div>
        )}

        {!isLoading && !ragError && hasResults && (
          <>
            <p className="text-[9px] text-c-text-4 px-1">
              <span className="font-medium text-c-text-2">{totalResults}</span> results for "{ragQuery}"
            </p>
            {sortedTypes.map(type => (
              <ResultGroup key={type} type={type} assets={ragResults[type]} onNavigate={handleNavigate} />
            ))}
          </>
        )}

        {!isLoading && !ragError && hasSearched && !hasResults && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
            <Search size={18} className="text-c-text-4" />
            <p className="text-[10px] text-c-text-3">No results for "{ragQuery}"</p>
          </div>
        )}

        {!isLoading && !ragError && !hasSearched && <EmptyState />}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-c-border bg-c-raised/40 flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasStyle ? 'Describe what you need...' : 'Select a style first...'}
            disabled={isLoading || !hasStyle}
            className="flex-1 bg-c-base border border-c-border rounded-lg px-2.5 py-2
              text-[11px] text-c-text placeholder-c-text-4
              focus:outline-none focus:border-c-accent disabled:opacity-40 transition-colors"
          />
          <button
            onClick={handleSearch}
            disabled={!input.trim() || isLoading || !hasStyle}
            className="px-2.5 py-2 bg-c-accent text-c-on-accent rounded-lg
              hover:bg-c-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
        <p className="text-[9px] text-c-text-4 mt-1 text-center">All types in active style</p>
      </div>
    </div>
  )
}

// ─── MAIN EXPORT — resizable panel like Sidebar ──────────────
export default function AISidebar() {
  const { isOpen, width, toggleSidebar, setWidth } = useAISidebarStore()

  const panelRef   = useRef(null)
  const isResizing = useRef(false)

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.button !== 0) return
      isResizing.current = true
      e.preventDefault()
    }
    const handleMouseMove = (e) => {
      if (!isResizing.current || !panelRef.current) return
      const rect     = panelRef.current.parentElement.getBoundingClientRect()
      const newWidth = rect.right - e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setWidth(newWidth)
    }
    const handleMouseUp = () => { isResizing.current = false }

    const handle = panelRef.current?.querySelector('.ai-resize-handle')
    handle?.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      handle?.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setWidth])

  // Collapsed — thin strip matching left Sidebar collapsed style
  if (!isOpen) {
    return (
      <div className="w-14 h-full bg-c-surface border-l border-c-border flex flex-col items-center justify-start pt-3 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg bg-c-raised hover:bg-c-hover text-c-text-3 hover:text-c-text transition-all"
          title="Open AI Search"
        >
          <PanelRightOpen size={18} />
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="h-full flex flex-col flex-shrink-0 relative"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle — left edge */}
      <div
        className="ai-resize-handle absolute left-0 top-0 bottom-0 w-1 cursor-col-resize
          hover:bg-c-accent/40 transition-colors z-10 group"
        title="Drag to resize"
      >
        <div className="absolute left-0 top-0 bottom-0 w-4 -translate-x-1.5" />
      </div>

      <AIPanelContent />
    </div>
  )
}