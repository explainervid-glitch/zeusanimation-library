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
  FileText,
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

// ─── TINY MARKDOWN RENDERER (bold / italic / bullets) ─────────
// Enough for the LLM recommendation; emoji pass through as plain text.
function renderInline(text, keyBase) {
  const nodes = []
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*)/g
  let last = 0, m, k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyBase}-${k++}`} className="font-semibold text-c-text">{tok.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={`${keyBase}-${k++}`}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function Markdownish({ text }) {
  const lines = text.split('\n')
  return (
    <div className="text-[11px] text-c-text-2 leading-relaxed space-y-1">
      {lines.map((line, i) => {
        const t = line.trim()
        if (!t) return null
        const bullet = /^[-*•]\s+/.test(t)
        const body = renderInline(bullet ? t.replace(/^[-*•]\s+/, '') : t, i)
        return bullet
          ? <div key={i} className="flex gap-1.5"><span className="text-c-accent flex-shrink-0">•</span><span>{body}</span></div>
          : <p key={i}>{body}</p>
      })}
    </div>
  )
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

// ─── STORYBOARD (script → scenes → assets) ───────────────────
function SceneRow({ scene, index, onNavigate }) {
  return (
    <div className="rounded-lg border border-c-border bg-c-raised/40 p-2 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 w-5 h-5 rounded-md bg-c-accent/15 text-c-accent text-[10px] font-bold flex items-center justify-center">
          {index + 1}
        </span>
        <p className="text-[11px] text-c-text-2 leading-snug select-text [&_*]:select-text">
          {scene.description}
        </p>
      </div>

      {scene.loading ? (
        <p className="flex items-center gap-1.5 text-[10px] text-c-text-4 pl-7">
          <Loader2 size={10} className="animate-spin" /> Finding assets…
        </p>
      ) : scene.error ? (
        <p className="text-[10px] text-red-400 pl-7">{scene.error}</p>
      ) : scene.assets.length === 0 ? (
        <p className="text-[10px] text-c-text-4 pl-7">No matching assets.</p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pl-7 pb-1 scrollbar-thin">
          {scene.assets.slice(0, 8).map(asset => (
            <button
              key={asset.id}
              onClick={() => onNavigate(asset)}
              title={asset.name}
              className="flex-shrink-0 w-12 h-12 rounded-md bg-c-base border border-c-border overflow-hidden hover:border-c-accent transition-all"
            >
              <AssetThumb asset={asset} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StoryboardView({ scenes, storyLoading, storyError, onNavigate }) {
  if (storyLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <Loader2 size={18} className="animate-spin text-c-accent" />
        <p className="text-[10px] text-c-text-3">Breaking down the script into scenes…</p>
      </div>
    )
  }
  if (storyError) {
    return (
      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
        <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] text-red-300 font-medium">Couldn&apos;t build storyboard</p>
          <p className="text-[9px] text-red-400/70 mt-0.5">{storyError}</p>
        </div>
      </div>
    )
  }
  if (!scenes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-2 px-4">
        <div className="w-12 h-12 rounded-2xl bg-c-accent/10 flex items-center justify-center">
          <FileText size={20} className="text-c-accent" />
        </div>
        <p className="text-sm font-medium text-c-text-2">Script → Storyboard</p>
        <p className="text-[10px] text-c-text-4">Paste a script below and break it into scenes.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-[9px] text-c-text-4 px-1">
        <span className="font-medium text-c-text-2">{scenes.length}</span> scenes
      </p>
      {scenes.map((scene, i) => (
        <SceneRow key={scene.id} scene={scene} index={i} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

// ─── QUEUE NOTICE — live "in line" indicator ─────────────────
// While a request is in flight, polls both servers' /queue-status and shows how
// many jobs are ahead. Hidden when it's just you (no contention).
function QueueNotice() {
  const isLoading    = useAISidebarStore(s => s.isLoading)
  const genLoading   = useAISidebarStore(s => s.genLoading)
  const storyLoading = useAISidebarStore(s => s.storyLoading)
  const busy = isLoading || genLoading || storyLoading

  const [ahead, setAhead] = useState(0)

  useEffect(() => {
    if (!busy) { setAhead(0); return }
    let alive = true
    const poll = async () => {
      try {
        const q = await window.api.queueStatus()
        if (!alive || !q?.success) return
        // queue_depth = jobs on that server (active + waiting). "Ahead of you"
        // is everything except your own — approximate but honest.
        const depth = Math.max(q.llm?.queue_depth || 0, q.rag?.queue_depth || 0)
        setAhead(Math.max(0, depth - 1))
      } catch { /* non-fatal — just skip this tick */ }
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => { alive = false; clearInterval(id) }
  }, [busy])

  if (!busy || ahead < 1) return null
  return (
    <div className="flex items-center gap-2 bg-c-accent/5 border border-c-accent/20 rounded-lg px-2.5 py-1.5">
      <Loader2 size={12} className="animate-spin text-c-accent flex-shrink-0" />
      <p className="text-[10px] text-c-text-2">
        Server busy — about{' '}
        <span className="font-semibold text-c-accent tabular-nums">{ahead}</span>{' '}
        ahead of you in the queue…
      </p>
    </div>
  )
}

// ─── PANEL CONTENT ───────────────────────────────────────────
function AIPanelContent({ onDragStart }) {
  const {
    ragResults, ragError, ragQuery,
    hasSearched, isLoading, ragSearch, clearChat, toggleSidebar,
    genText, genLoading, genError,
    mode, setMode, script, setScript, scenes, storyLoading, storyError, runStoryboard,
    lang, setLang,
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

  const handleRunStoryboard = async () => {
    if (!script.trim() || storyLoading || !hasStyle) return
    await runStoryboard(script.trim(), styleId)
  }

  const totalResults = Object.values(ragResults).reduce((s, a) => s + a.length, 0)
  const typeOrder    = ['background', 'character', 'animation', 'inspiration', 'other']
  const sortedTypes  = Object.keys(ragResults).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b))
  const hasResults   = totalResults > 0

  return (
    <div className="h-full flex flex-col bg-c-surface border-l border-c-border">

      {/* Header — also the drag handle for moving the panel */}
      <div
        onMouseDown={onDragStart}
        className="px-3 py-2.5 border-b border-c-border flex items-center justify-between flex-shrink-0 cursor-move select-none"
      >
        <p className="text-[10px] text-c-text-4 uppercase tracking-widest font-medium">
          Co-Worker
        </p>
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
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
            title="Hide Co-Worker"
          >
            <PanelRightClose size={16} />
          </button>
        </div>
      </div>

      {/* Mode toggle + LLM output language */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-c-border flex-shrink-0">
        <div className="flex gap-1 flex-1">
          {[['search', 'Search'], ['script', 'Script']].map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-all
                ${mode === m ? 'bg-c-accent text-c-on-accent' : 'bg-c-raised text-c-text-3 hover:text-c-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setLang(lang === 'id' ? 'en' : 'id')}
          title="LLM output language (RAG search always stays English)"
          className="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-c-raised text-c-text-3 hover:text-c-accent transition-all"
        >
          {lang}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">

        {/* Live queue position (only shows when others are ahead of you) */}
        <QueueNotice />

        {!hasStyle && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20
            rounded-lg px-2.5 py-2">
            <AlertCircle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-yellow-300">Select a style to scope {mode === 'script' ? 'the storyboard' : 'search'}.</p>
          </div>
        )}

        {mode === 'script' && (
          <StoryboardView scenes={scenes} storyLoading={storyLoading} storyError={storyError} onNavigate={handleNavigate} />
        )}

        {mode === 'search' && isLoading && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Loader2 size={18} className="animate-spin text-c-accent" />
            <p className="text-[10px] text-c-text-3">Searching...</p>
          </div>
        )}

        {mode === 'search' && !isLoading && ragError && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
            <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-red-300 font-medium">Search failed</p>
              <p className="text-[9px] text-red-400/70 mt-0.5">{ragError}</p>
            </div>
          </div>
        )}

        {/* LLM recommendation — fills in after results while it generates */}
        {mode === 'search' && !isLoading && !ragError && (genLoading || genText || genError) && (
          <div className="rounded-lg bg-c-accent/5 px-2.5 py-2 space-y-1.5 select-text [&_*]:select-text cursor-text">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-c-accent uppercase tracking-wider">
              <Sparkles size={11} /> Recommendation
            </div>
            {genLoading && (
              <p className="flex items-center gap-1.5 text-[10px] text-c-text-3">
                <Loader2 size={11} className="animate-spin" /> Generating…
              </p>
            )}
            {genError && <p className="text-[10px] text-red-400">{genError}</p>}
            {genText && <Markdownish text={genText} />}
          </div>
        )}

        {mode === 'search' && !isLoading && !ragError && hasResults && (
          <>
            <p className="text-[9px] text-c-text-4 px-1">
              <span className="font-medium text-c-text-2">{totalResults}</span> results for "{ragQuery}"
            </p>
            {sortedTypes.map(type => (
              <ResultGroup key={type} type={type} assets={ragResults[type]} onNavigate={handleNavigate} />
            ))}
          </>
        )}

        {mode === 'search' && !isLoading && !ragError && hasSearched && !hasResults && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
            <Search size={18} className="text-c-text-4" />
            <p className="text-[10px] text-c-text-3">No results for "{ragQuery}"</p>
          </div>
        )}

        {mode === 'search' && !isLoading && !ragError && !hasSearched && <EmptyState />}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-c-border bg-c-raised/40 flex-shrink-0">
        {mode === 'search' ? (
          <>
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
          </>
        ) : (
          <>
            <textarea
              value={script}
              onChange={e => setScript(e.target.value)}
              placeholder={hasStyle ? 'Paste your script here…' : 'Select a style first…'}
              disabled={storyLoading || !hasStyle}
              rows={3}
              className="w-full bg-c-base border border-c-border rounded-lg px-2.5 py-2
                text-[11px] text-c-text placeholder-c-text-4 resize-y
                focus:outline-none focus:border-c-accent disabled:opacity-40 transition-colors"
            />
            <button
              onClick={handleRunStoryboard}
              disabled={!script.trim() || storyLoading || !hasStyle}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2.5 py-2
                bg-c-accent text-c-on-accent rounded-lg text-[11px] font-medium
                hover:bg-c-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {storyLoading
                ? <><Loader2 size={13} className="animate-spin" /> Breaking down…</>
                : <><Sparkles size={13} /> Break into scenes</>}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── MAIN EXPORT — the Co-Worker panel ────────────────────────
// A floating, draggable/resizable chat panel. Toggled from the circular
// Co-Worker button in the toolbar (see Toolbar.jsx).
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export default function AISidebar() {
  const { isOpen, width, setWidth, posX, posY, setPos } = useAISidebarStore()
  const drag = useRef(null)   // { mode:'move'|'resize', offX, offY, w, h, left }

  // Keep the panel mounted through a short exit animation.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown]     = useState(false)

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 160)
    return () => clearTimeout(t)
  }, [isOpen])

  useEffect(() => {
    const onMove = (e) => {
      const d = drag.current
      if (!d) return
      if (d.mode === 'move') {
        const nx = clamp(e.clientX - d.offX, 4, window.innerWidth  - d.w - 4)
        const ny = clamp(e.clientY - d.offY, 4, window.innerHeight - d.h - 4)
        setPos(nx, ny)
      } else {
        const nw = e.clientX - d.left
        if (nw >= MIN_WIDTH && nw <= MAX_WIDTH) setWidth(nw)
      }
    }
    const onUp = () => { drag.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [setPos, setWidth])

  if (!mounted) return null

  const panelH      = Math.min(window.innerHeight * 0.72, 640)
  const defaultLeft = Math.max(12, window.innerWidth - width - 16)
  // Clamp on render too, so a stored off-screen position always comes back in view.
  const left = clamp(posX ?? defaultLeft, 4, window.innerWidth  - width  - 4)
  const top  = clamp(posY ?? 56,          4, window.innerHeight - panelH - 4)

  const startMove = (e) => {
    if (e.button !== 0) return
    drag.current = { mode: 'move', offX: e.clientX - left, offY: e.clientY - top, w: width, h: panelH }
    e.preventDefault()
  }
  const startResize = (e) => {
    if (e.button !== 0) return
    drag.current = { mode: 'resize', left }
    e.preventDefault()
  }

  return (
    <div
      className="fixed z-40 flex flex-col rounded-2xl border border-c-border
        shadow-2xl overflow-hidden"
      style={{
        left, top, width, height: panelH,
        transformOrigin: 'top right',
        transform: shown ? 'scale(1)' : 'scale(0.94)',
        opacity:   shown ? 1 : 0,
        transition: 'transform 160ms ease-out, opacity 140ms ease-out',
      }}
    >
      {/* Resize handle — right edge */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize
          hover:bg-c-accent/40 transition-colors z-20"
        title="Drag to resize"
      />
      <AIPanelContent onDragStart={startMove} />
    </div>
  )
}