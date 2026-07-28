import { useState, useEffect, useRef } from 'react'
import { X, User, PersonStanding, Combine, ArrowRight, Loader, AlertCircle, Clipboard } from 'lucide-react'
import useCompileStore from '../../store/useCompileStore'
import useAssetStore from '../../store/useAssetStore'
import useProjectStore from '../../store/useProjectStore'
import useSettingsStore from '../../store/useSettingsStore'
import CompileModal from './CompileModal'
import FlaLibraryTree, { SELECTABLE } from '../shared/FlaLibraryTree'

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

// ─── 2D: SYMBOL PICKER (from the movement .fla, read off disk) ─
function SymbolPicker({ movement, symbol, onSelect }) {
  const [status, setStatus] = useState('idle')   // idle | loading | ready | error
  const [items, setItems]   = useState([])
  const [error, setError]   = useState(null)

  // onSelect via ref: the effect below must depend ONLY on the movement path.
  // A changing callback identity in the deps would re-run it on every parent
  // render (the app polls the DB in the background), re-firing the Animate
  // pre-warm repeatedly while the user is idle.
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    let alive = true
    const pick = (v) => onSelectRef.current?.(v)
    pick(null)
    if (!movement?.raw_path || !/\.fla$/i.test(movement.raw_path)) {
      setStatus('idle'); setItems([]); return
    }
    setStatus('loading')
    // Instant disk read of the .fla library — keep folders so the tree can
    // group by folder exactly like the Import Symbol modal.
    window.api.readFlaLibrary({ flaPath: movement.raw_path })
      .then((res) => {
        if (!alive) return
        if (!res.success) { setStatus('error'); setError(res.error); return }
        const all = res.items || []
        setItems(all)
        setStatus('ready')
        // Auto-pick when there's exactly one symbol (usual 1-2 dummy case).
        const symbols = all.filter(i => SELECTABLE.has(i.type))
        if (symbols.length === 1) pick(symbols[0].path)
      })
      .catch((e) => { if (alive) { setStatus('error'); setError(e.message) } })

    // Pre-warm: let Animate start loading the movement in the background so
    // the Compile click doesn't pay the file-open cost.
    window.api.animateStatus().then((st) => {
      if (st?.connected) {
        window.api.animateRun({ action: 'open-fla', params: { flaPath: movement.raw_path } }).catch(() => {})
      }
    }).catch(() => {})

    return () => { alive = false }
  }, [movement?.raw_path])

  if (!movement) return null

  return (
    <div className="pt-1">
      <p className="text-[9px] uppercase tracking-wider text-c-text-3 mb-1">Movement Symbol</p>

      {status === 'loading' && (
        <p className="flex items-center gap-1.5 text-[10px] text-c-text-4 py-1">
          <Loader size={10} className="animate-spin" /> Reading library…
        </p>
      )}
      {status === 'error' && (
        <p className="text-[10px] text-red-400 py-1">{error}</p>
      )}
      {status === 'ready' && items.length === 0 && (
        <p className="text-[10px] text-c-text-4 py-1">No symbols in this movement file.</p>
      )}
      {status === 'ready' && items.length > 0 && (
        <div className="max-h-36 overflow-y-auto border border-c-border rounded-lg bg-c-base/40 p-1">
          <FlaLibraryTree items={items} selected={symbol} onSelect={onSelect} dense />
        </div>
      )}
    </div>
  )
}

// ─── TRAY ─────────────────────────────────────────────────────
export default function CompileTray() {
  const { isCompileMode, character, movement, exitCompileMode, clearCharacter, clearMovement } = useCompileStore()
  const activePackIndex     = useAssetStore((s) => s.activePackIndex)
  const activeProject       = useProjectStore((s) => s.activeProject)
  const autoResolveConflict = useSettingsStore((s) => s.autoResolveConflict)
  const [showModal, setShowModal] = useState(false)

  // 2D compile run state
  const [symbol, setSymbol]   = useState(null)
  const [step, setStep]       = useState('idle')   // idle | copy | animate | done | error
  const [stepMsg, setStepMsg] = useState('')

  // Name the character copy lands under in {project}/Chars. Defaults to the
  // source file name and is pre-selected, so typing replaces it outright.
  const [charName, setCharName] = useState('')
  const charNameRef = useRef(null)

  const is2D = activePackIndex === 0

  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : '')

  useEffect(() => {
    setCharName(baseName(character?.raw_path))
    // Highlight the default so it can be typed over immediately.
    const t = setTimeout(() => charNameRef.current?.select(), 0)
    return () => clearTimeout(t)
  }, [character?.raw_path])

  // Reset run state when inputs change
  useEffect(() => { setStep('idle'); setStepMsg('') }, [character?.id, movement?.id, symbol])

  if (!isCompileMode) return null

  const ready   = !!character && !!movement
  const ready2d = ready && !!symbol && !!charName.trim() && step !== 'copy' && step !== 'animate'

  // ── The 2D flow: copy char → open + import symbol → reload clipboard ──
  const runCompile2d = async () => {
    setStep('copy'); setStepMsg('Copying character to project…')
    try {
      if (!activeProject?.path) {
        setStep('error'); setStepMsg('No active project — create or select one in the bottom bar.')
        return
      }
      if (!character.raw_path || !/\.fla$/i.test(character.raw_path)) {
        setStep('error'); setStepMsg('Selected character has no .fla source file.')
        return
      }

      // 1) Copy the character .fla into {project}/Chars, under the chosen name
      //    (sendToProject re-appends the .fla extension if it was dropped).
      const sent = await window.api.sendToProject({
        sourcePath:  character.raw_path,
        projectPath: activeProject.path,
        targetName:  charName.trim() || undefined,
      })
      if (!sent.success) { setStep('error'); setStepMsg(sent.error); return }

      // 2+3+4) One bridge job: open char, import symbol (user answers the
      // conflict dialog with "Don't replace"), re-copy to clipboard.
      const st = await window.api.animateStatus().catch(() => ({ connected: false }))
      if (!st.connected) {
        setStep('error'); setStepMsg('Animate not connected — open the ZeusPack Bridge panel in Animate.')
        return
      }
      setStep('animate')
      setStepMsg(autoResolveConflict
        ? 'In Animate: importing symbol… (conflict dialog auto-answered)'
        : 'In Animate: importing symbol… (answer "Don\'t replace" if asked)')
      const res = await window.api.animateRun({
        action: 'compile-2d',
        params: { charPath: sent.data, movementPath: movement.raw_path, symbol },
        timeoutMs: 300000,          // the conflict dialog waits on the user
        autoDialog: autoResolveConflict,
      }).catch((e) => ({ success: false, error: e.message }))

      if (!res.success) { setStep('error'); setStepMsg(res.error || res.message || 'Compile failed.'); return }
      setStep('done')
      const closedN = res.data?.closed?.length || 0
      const dlgN    = res.dialogsAnswered || 0
      if (autoResolveConflict && !dlgN && res.dialogCandidates) {
        // Auto-answer never fired — log what Animate actually had on screen so
        // the real dialog can be identified.
        console.log('[Compile2D] auto-answer missed. Animate windows:', res.dialogCandidates)
      }
      setStepMsg(res.data?.recopied
        ? `Clipboard ready — press Ctrl+V in your Animate file.` +
          `${dlgN ? ` Auto-answered ${dlgN} conflict dialog${dlgN > 1 ? 's' : ''}.` : ''}` +
          `${closedN ? ' Working files closed (not saved).' : ''}`
        : (res.message || 'Done.'))
    } catch (e) {
      setStep('error'); setStepMsg(e.message)
    }
  }

  const busy = step === 'copy' || step === 'animate'

  return (
    <>
      <div className="fixed bottom-16 right-4 z-40 w-72
        bg-c-surface border border-c-border rounded-2xl shadow-2xl overflow-hidden
        animate-[compileSlideIn_220ms_ease-out]">

        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-c-border">
          <div className="flex items-center gap-2">
            <Combine size={14} className="text-c-accent" />
            <span className="text-xs font-bold text-c-text">Compile{is2D ? ' · Animate' : ''}</span>
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

          {/* 2D: name for the copy placed in {project}/Chars */}
          {is2D && character && (
            <div>
              <p className="text-[9px] uppercase tracking-wider text-c-text-4 mb-1">Save as</p>
              <input
                ref={charNameRef}
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="File name"
                title="Name for the character copy in the project folder"
                className="w-full px-2 py-1 rounded-md text-[11px]
                  bg-c-raised text-c-text placeholder-c-text-4
                  border border-c-border-2 focus:border-c-accent outline-none transition-colors"
              />
            </div>
          )}

          <div className="flex justify-center text-c-text-4"><ArrowRight size={12} className="rotate-90" /></div>
          <Slot label="Movement"  Icon={PersonStanding} asset={movement}  onClear={clearMovement} />

          {/* 2D: pick the movement symbol to bring across */}
          {is2D && <SymbolPicker movement={movement} symbol={symbol} onSelect={setSymbol} />}
        </div>

        {/* Compile button */}
        <div className="px-3.5 pb-3.5 space-y-2">
          <button
            onClick={() => (is2D ? runCompile2d() : setShowModal(true))}
            disabled={is2D ? !ready2d : !ready}
            title={is2D
              ? (ready2d ? 'Copy character to project, import symbol, load clipboard'
                : !ready ? 'Pick a Character and a Movement first'
                : !charName.trim() ? 'Enter a file name for the character copy'
                : 'Pick a symbol first')
              : (ready ? 'Import character, then append movement' : 'Pick a Character and a Movement first')}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold
              transition-all
              ${(is2D ? ready2d : ready)
                ? 'bg-c-accent text-c-on-accent hover:bg-c-accent-h'
                : 'bg-c-accent/40 text-c-on-accent/50 cursor-not-allowed'
              }`}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Combine size={13} />}
            {busy ? 'Compiling…' : 'Compile'}
          </button>

          {/* 2D run status */}
          {is2D && step !== 'idle' && (
            <div className={`flex items-start gap-1.5 text-[10px] leading-snug
              ${step === 'error' ? 'text-red-400' : step === 'done' ? 'text-green-400' : 'text-c-text-3'}`}>
              {step === 'error' ? <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
                : step === 'done' ? <Clipboard size={11} className="flex-shrink-0 mt-0.5" />
                : <Loader size={11} className="animate-spin flex-shrink-0 mt-0.5" />}
              <span>{stepMsg}</span>
            </div>
          )}
        </div>
      </div>

      {showModal && !is2D && (
        <CompileModal
          character={character}
          movement={movement}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
