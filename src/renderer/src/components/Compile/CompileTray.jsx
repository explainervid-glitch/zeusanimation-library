import { useState } from 'react'
import { X, User, PersonStanding, Combine, ArrowRight } from 'lucide-react'
import useCompileStore from '../../store/useCompileStore'
import CompileModal from './CompileModal'

// ─── MINI ASSET THUMB ─────────────────────────────────────────
function Thumb({ asset }) {
  const [err, setErr] = useState(false)
  const toUrl = (p) => (p ? 'file:///' + p.replace(/\\/g, '/') : null)
  const path  = asset?.mp4_path || asset?.thumbnail_path || null
  const url   = toUrl(path)
  const isVideo = path && /\.(mp4|webm)$/i.test(path)
  const isImage = path && /\.(jpg|jpeg|png|gif|webp)$/i.test(path)

  if (!err && url && isVideo) {
    return <video src={url} muted loop playsInline autoPlay onError={() => setErr(true)} className="w-full h-full object-cover" />
  }
  if (!err && url && isImage) {
    return <img src={url} alt={asset.name} onError={() => setErr(true)} className="w-full h-full object-cover" />
  }
  return null
}

// ─── SLOT ─────────────────────────────────────────────────────
function Slot({ label, Icon, asset, onClear }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0
        border ${asset ? 'border-c-accent' : 'border-dashed border-c-border-2'}
        bg-c-base flex items-center justify-center
        ${asset ? 'animate-[compilePop_180ms_ease-out]' : ''}`}
      >
        {asset ? <Thumb asset={asset} /> : <Icon size={16} className="text-c-text-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] uppercase tracking-wider text-c-text-4">{label}</p>
        <p className="text-[11px] font-medium text-c-text truncate">
          {asset ? asset.name : <span className="text-c-text-4 font-normal">Click a {label.toLowerCase()}…</span>}
        </p>
      </div>
      {asset && (
        <button
          onClick={onClear}
          className="flex-shrink-0 text-c-text-4 hover:text-c-text transition-colors"
          title={`Clear ${label}`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

// ─── TRAY ─────────────────────────────────────────────────────
export default function CompileTray() {
  const { isCompileMode, character, movement, exitCompileMode, clearCharacter, clearMovement } = useCompileStore()
  const [showModal, setShowModal] = useState(false)

  if (!isCompileMode) return null

  const ready = !!character && !!movement

  return (
    <>
      <div className="fixed bottom-16 right-4 z-40 w-72
        bg-c-surface border border-c-border rounded-2xl shadow-2xl overflow-hidden
        animate-[compileSlideIn_220ms_ease-out]">

        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-c-border">
          <div className="flex items-center gap-2">
            <Combine size={14} className="text-c-accent" />
            <span className="text-xs font-bold text-c-text">Compile</span>
          </div>
          <button
            onClick={exitCompileMode}
            className="text-c-text-3 hover:text-c-text transition-colors"
            title="Exit Compile mode"
          >
            <X size={15} />
          </button>
        </div>

        {/* Slots */}
        <div className="px-3.5 py-3 space-y-2.5">
          <Slot label="Character" Icon={User}           asset={character} onClear={clearCharacter} />
          <div className="flex justify-center text-c-text-4"><ArrowRight size={12} className="rotate-90" /></div>
          <Slot label="Movement"  Icon={PersonStanding} asset={movement}  onClear={clearMovement} />
        </div>

        {/* Compile button */}
        <div className="px-3.5 pb-3.5">
          <button
            onClick={() => setShowModal(true)}
            disabled={!ready}
            title={ready ? 'Import character, then append movement' : 'Pick a Character and a Movement first'}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
              transition-all
              ${ready
                ? 'bg-c-accent text-c-on-accent hover:bg-c-accent-h'
                : 'bg-c-accent/40 text-c-on-accent/50 cursor-not-allowed'
              }`}
          >
            <Combine size={13} />
            Compile
          </button>
        </div>
      </div>

      {showModal && (
        <CompileModal
          character={character}
          movement={movement}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
