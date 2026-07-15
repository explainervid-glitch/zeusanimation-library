import { useState, useEffect, useRef } from 'react'
import { X, Combine, Loader, Check, AlertCircle, RefreshCw, Monitor } from 'lucide-react'
import useProjectStore from '../../store/useProjectStore'
import useSettingsStore from '../../store/useSettingsStore'
import useCompileStore from '../../store/useCompileStore'

function StatusDot({ status }) {
  const styles = { scanning: 'bg-yellow-400 animate-pulse', found: 'bg-green-400', empty: 'bg-red-400' }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles[status] || styles.empty}`} />
}

function basename(p) {
  return p ? p.split(/[\\/]/).pop() : 'Untitled'
}

// Combined Compile flow: 1) copy Character into the project  2) scan Blender
// 3) pick a Blender instance + Character collection + Movement collection
// 4) import the Character (append or link per the Import method setting), then
// append the Movement — both into the Temporary scene.
export default function CompileModal({ character, movement, onClose }) {
  const activeProject     = useProjectStore((s) => s.activeProject)
  const blenderImportMode = useSettingsStore((s) => s.blenderImportMode)
  const exitCompileMode   = useCompileStore((s) => s.exitCompileMode)
  const isLink = blenderImportMode === 'link'

  const [stage, setStage] = useState('preparing')   // preparing | ready | error
  const [prepError, setPrepError] = useState(null)
  const [projectCharPath, setProjectCharPath] = useState(null)
  const [copiedFresh, setCopiedFresh] = useState(false)

  const [scanStatus, setScanStatus] = useState('scanning')
  const [instances,  setInstances]  = useState([])
  const [target,     setTarget]     = useState(null)

  const [charCols, setCharCols] = useState([])
  const [moveCols, setMoveCols] = useState([])
  const [charCol,  setCharCol]  = useState('')
  const [moveCol,  setMoveCol]  = useState('')
  const [loadingCols, setLoadingCols] = useState(false)

  const [compiling, setCompiling] = useState(false)
  const [step,      setStep]      = useState(null)   // 'character' | 'movement'
  const [done,      setDone]      = useState(false)
  const [error,     setError]     = useState(null)

  // ── Step 1: copy the character into the project ───────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!character?.raw_path || !movement?.raw_path) {
        setPrepError('Both the Character and Movement need a .blend source file.')
        setStage('error'); return
      }
      if (!activeProject?.path) {
        setPrepError('No active project — create or select one in the bottom bar first.')
        setStage('error'); return
      }
      const r = await window.api.sendToProject({ sourcePath: character.raw_path, projectPath: activeProject.path })
      if (cancelled) return
      if (!r.success) {
        setPrepError(r.error || 'Failed to copy the character into the project.')
        setStage('error'); return
      }
      setProjectCharPath(r.data)
      setCopiedFresh(!!r.copied)
      setStage('ready')
    })()
    return () => { cancelled = true }
  }, [character, movement, activeProject])

  // ── Step 2: scan Blender ──────────────────────────────────────
  const scanBlenders = async () => {
    setScanStatus('scanning'); setInstances([]); setTarget(null)
    setCharCols([]); setMoveCols([]); setCharCol(''); setMoveCol(''); setError(null)
    const found = await window.api.blenderScanPorts()
    setInstances(found)
    setScanStatus(found.length > 0 ? 'found' : 'empty')
    if (found.length === 1) selectTarget(found[0])
  }

  // ── Step 3: pick target → load BOTH collection lists ──────────
  const selectTarget = async (instance) => {
    setTarget(instance)
    setCharCols([]); setMoveCols([]); setCharCol(''); setMoveCol(''); setError(null)
    setLoadingCols(true)
    const [rc, rm] = await Promise.all([
      window.api.blenderGetCollections(projectCharPath, instance.port),
      window.api.blenderGetCollections(movement.raw_path, instance.port),
    ])
    setLoadingCols(false)
    if (rc.success) { setCharCols(rc.data || []); if (rc.data?.length === 1) setCharCol(rc.data[0]) }
    else setError(rc.error)
    if (rm.success) { setMoveCols(rm.data || []); if (rm.data?.length === 1) setMoveCol(rm.data[0]) }
    else setError((prev) => prev || rm.error)
  }

  useEffect(() => {
    if (stage === 'ready') scanBlenders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // Fresh state for the mount-once key listener + close handlers.
  const closeRef = useRef({ done, copiedFresh, projectCharPath })
  useEffect(() => { closeRef.current = { done, copiedFresh, projectCharPath } })

  const requestClose = async () => {
    const { done: d, copiedFresh: c, projectCharPath: p } = closeRef.current
    if (!d && c && p) { try { await window.api.deleteProjectFile(p) } catch { /* best effort */ } }
    onClose()
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Step 4: compile — import character, then append movement ──
  const handleCompile = async () => {
    if (!target || !charCol || !moveCol || !projectCharPath) return
    setCompiling(true); setError(null)

    // 1) Character → import (append or link) into the Temporary scene
    setStep('character')
    const charRes = isLink
      ? await window.api.blenderLink({ filePath: projectCharPath, collection: charCol, port: target.port })
      : await window.api.blenderAppend({ filePath: projectCharPath, collection: charCol, port: target.port, tempScene: true })
    if (!charRes.success) {
      setCompiling(false); setStep(null); setError(`Character: ${charRes.error}`); return
    }

    // 2) Movement → append into the same Temporary scene
    setStep('movement')
    const moveRes = await window.api.blenderAppend({ filePath: movement.raw_path, collection: moveCol, port: target.port, tempScene: true })

    setCompiling(false); setStep(null)
    if (!moveRes.success) { setError(`Movement: ${moveRes.error}`); return }

    setDone(true)
    setTimeout(() => { exitCompileMode(); onClose() }, 1300)
  }

  const canCompile = target && charCol && moveCol && !compiling && !done

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={requestClose}>
      <div className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border">
          <div className="flex items-center gap-2.5">
            <Combine size={15} className="text-c-accent" />
            <h2 className="text-sm font-bold text-c-text">Compile to Blender</h2>
          </div>
          <button onClick={requestClose} className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {stage === 'preparing' && (
            <div className="flex items-center gap-2 py-6 justify-center text-c-text-3 text-xs">
              <Loader size={14} className="animate-spin" /> Copying character into project…
            </div>
          )}

          {stage === 'error' && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
              <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-c-error">{prepError}</p>
            </div>
          )}

          {stage === 'ready' && (
            <>
              {/* Char + movement summary */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-c-raised rounded-lg px-2.5 py-1.5 border border-c-border min-w-0">
                  <p className="text-[9px] uppercase tracking-wider text-c-text-4">Character</p>
                  <p className="font-medium text-c-text truncate" title={character.name}>{character.name}</p>
                </div>
                <div className="bg-c-raised rounded-lg px-2.5 py-1.5 border border-c-border min-w-0">
                  <p className="text-[9px] uppercase tracking-wider text-c-text-4">Movement</p>
                  <p className="font-medium text-c-text truncate" title={movement.name}>{movement.name}</p>
                </div>
              </div>

              {/* Blender target */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={scanStatus} />
                    <span className="text-xs font-medium text-c-text-2">
                      {scanStatus === 'scanning' ? 'Detecting Blender...'
                        : scanStatus === 'found'  ? `${instances.length} Blender Detected`
                        : 'No Blender Detected'}
                    </span>
                  </div>
                  <button onClick={scanBlenders} disabled={scanStatus === 'scanning'}
                    className="p-1.5 rounded-lg text-c-text-2 hover:text-c-text hover:bg-c-raised transition-colors disabled:opacity-30" title="Rescan">
                    <RefreshCw size={12} className={scanStatus === 'scanning' ? 'animate-spin' : ''} />
                  </button>
                </div>

                {scanStatus === 'found' && (
                  <div className="space-y-1.5">
                    {instances.map(inst => (
                      <button key={inst.port} onClick={() => selectTarget(inst)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all
                          ${target?.port === inst.port
                            ? 'bg-c-accent/10 border-c-accent text-c-accent'
                            : 'bg-c-raised border-c-border text-c-text-2 hover:bg-c-hover hover:text-c-text'}`}>
                        <Monitor size={13} className="flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{basename(inst.file)}</p>
                          <p className="text-[10px] text-c-text-3 mt-0.5">Blender {inst.blender}</p>
                        </div>
                        {target?.port === inst.port && <Check size={12} className="flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {scanStatus === 'empty' && (
                  <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3">
                    <p className="text-[11px] text-c-text-4">Open Blender with the ZeusPack Bridge add-on enabled, then click refresh.</p>
                  </div>
                )}
              </div>

              {/* Collection pickers */}
              {target && (
                <div className="space-y-2.5">
                  {loadingCols ? (
                    <div className="flex items-center gap-2 py-2 text-c-text-3 text-xs">
                      <Loader size={13} className="animate-spin" /> Loading collections...
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-c-text-2 mb-1">
                          Character collection ({isLink ? 'link' : 'append'})
                        </label>
                        <select value={charCol} onChange={e => setCharCol(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-c-raised border border-c-border-2 text-c-text focus:outline-none focus:border-c-accent">
                          <option value="">{charCols.length ? '— Select —' : '— No collections —'}</option>
                          {charCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-c-text-2 mb-1">Movement collection (append)</label>
                        <select value={moveCol} onChange={e => setMoveCol(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-c-raised border border-c-border-2 text-c-text focus:outline-none focus:border-c-accent">
                          <option value="">{moveCols.length ? '— Select —' : '— No collections —'}</option>
                          {moveCols.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
                  <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-c-error">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-c-border bg-c-base/40">
          <button onClick={requestClose} className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors">
            Cancel
          </button>
          {stage === 'ready' && (
            <button onClick={handleCompile} disabled={!canCompile}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40">
              {done ? (
                <><Check size={12} /> Compiled!</>
              ) : compiling ? (
                <><Loader size={12} className="animate-spin" /> {step === 'movement' ? 'Appending movement…' : 'Importing character…'}</>
              ) : (
                <><Combine size={12} /> Compile</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
