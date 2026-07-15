import { useState, useEffect, useRef } from 'react'
import { X, Import, Loader, Check, AlertCircle, RefreshCw, Monitor } from 'lucide-react'

// ─── STATUS DOT ───────────────────────────────────────────────
function StatusDot({ status }) {
  const styles = {
    scanning: 'bg-yellow-400 animate-pulse',
    found:    'bg-green-400',
    empty:    'bg-red-400',
  }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles[status] || styles.empty}`} />
}

function basename(filePath) {
  if (!filePath) return 'Untitled'
  return filePath.split(/[\\/]/).pop()
}

// Import a Character asset into a running Blender instance.
// Flow (identical for both methods): 1) copy asset into {project}/Chars (skips
// if already there — preserves any edits on the project copy)  2) scan for a
// running Blender  3) list collections FROM THE PROJECT COPY (not the library
// path)  4) append OR link (per `mode`) the chosen collection into Blender's
// Temporary scene.
export default function BlenderImportModal({ asset, projectPath, mode = 'append', onClose }) {
  const isAppend = mode !== 'link'
  const Verb     = isAppend ? 'Append' : 'Link'

  const [stage, setStage] = useState('preparing')   // preparing | ready | error
  const [prepError, setPrepError] = useState(null)
  const [projectFilePath, setProjectFilePath] = useState(null)
  // true only if THIS run created a new file in {project}/Chars (not a
  // pre-existing copy the user may already be editing there) — used to decide
  // whether cancelling should clean it up.
  const [copiedFresh, setCopiedFresh] = useState(false)

  const [scanStatus,  setScanStatus]  = useState('scanning')  // scanning | found | empty
  const [instances,   setInstances]   = useState([])
  const [target,      setTarget]      = useState(null)
  const [collections, setCollections] = useState([])
  const [loadingCols, setLoadingCols] = useState(false)
  const [selected,    setSelected]    = useState(null)
  const [working,     setWorking]     = useState(false)
  const [done,        setDone]        = useState(false)
  const [error,       setError]       = useState(null)

  // ── Step 1: copy the asset into {project}/Chars ───────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!asset.raw_path) {
        setPrepError('This asset has no source file (.blend) to import.')
        setStage('error')
        return
      }
      if (!projectPath) {
        setPrepError('No active project — create or select one in the bottom bar first.')
        setStage('error')
        return
      }
      const result = await window.api.sendToProject({ sourcePath: asset.raw_path, projectPath })
      if (cancelled) return
      if (!result.success) {
        setPrepError(result.error || 'Failed to copy asset into the project.')
        setStage('error')
        return
      }
      setProjectFilePath(result.data)
      setCopiedFresh(!!result.copied)
      setStage('ready')
    })()
    return () => { cancelled = true }
  }, [asset.raw_path, projectPath])

  // ── Step 2: scan all Blender ports ─────────────────────────────
  const scanBlenders = async () => {
    setScanStatus('scanning')
    setInstances([])
    setTarget(null)
    setCollections([])
    setSelected(null)
    setError(null)

    const found = await window.api.blenderScanPorts()
    setInstances(found)
    setScanStatus(found.length > 0 ? 'found' : 'empty')

    if (found.length === 1) selectTarget(found[0])
  }

  // ── Step 3: pick target → load collections FROM PROJECT COPY ──
  const selectTarget = async (instance) => {
    setTarget(instance)
    setCollections([])
    setSelected(null)
    setError(null)

    if (!projectFilePath) return

    setLoadingCols(true)
    const result = await window.api.blenderGetCollections(projectFilePath, instance.port)
    setLoadingCols(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setCollections(result.data || [])
    if (result.data?.length === 1) setSelected(result.data[0])
  }

  useEffect(() => {
    if (stage === 'ready') scanBlenders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // Kept fresh every render so requestClose (used by a mount-once key listener,
  // and by button handlers) never reads stale state via closures.
  const closeStateRef = useRef({ done, copiedFresh, projectFilePath })
  useEffect(() => {
    closeStateRef.current = { done, copiedFresh, projectFilePath }
  })

  // Dismiss the modal. If the asset was freshly copied into the project this
  // session and never actually got imported, delete that copy — otherwise a
  // cancelled attempt would leave an orphaned file in {project}/Chars.
  // Never deletes a successfully-imported file (Blender may point at it, for
  // link), and never deletes a copy that already existed before this opened.
  const requestClose = async () => {
    const { done: wasDone, copiedFresh: wasCopied, projectFilePath: path } = closeStateRef.current
    if (!wasDone && wasCopied && path) {
      try { await window.api.deleteProjectFile(path) } catch { /* best effort */ }
    }
    onClose()
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Step 4: append or link ────────────────────────────────────
  const handleImport = async () => {
    if (!selected || !target || !projectFilePath) return
    setWorking(true)
    setError(null)

    const result = isAppend
      ? await window.api.blenderAppend({ filePath: projectFilePath, collection: selected, port: target.port, tempScene: true })
      : await window.api.blenderLink({ filePath: projectFilePath, collection: selected, port: target.port })

    setWorking(false)

    if (result.success) {
      setDone(true)
      setTimeout(onClose, 1200)   // success — do NOT clean up the copy
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border">
          <div className="flex items-center gap-2.5">
            <Import size={15} className="text-c-accent" />
            <h2 className="text-sm font-bold text-c-text">{Verb} Character to Blender</h2>
          </div>
          <button onClick={requestClose}
            className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* ── Preparing / copy error ── */}
          {stage === 'preparing' && (
            <div className="flex items-center gap-2 py-6 justify-center text-c-text-3 text-xs">
              <Loader size={14} className="animate-spin" />
              Copying into project…
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
              {/* ── Project file info ── */}
              <div className="bg-c-raised rounded-lg px-3 py-2 border border-c-border">
                <p className="text-[10px] text-c-text-2 mb-0.5">Project File</p>
                <p className="text-xs font-medium text-c-text truncate" title={projectFilePath}>
                  {basename(projectFilePath)}
                </p>
              </div>

              {/* ── Select Blender Target ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={scanStatus} />
                    <span className="text-xs font-medium text-c-text-2">
                      {scanStatus === 'scanning' ? 'Detecting Blender...'
                        : scanStatus === 'found'   ? `${instances.length} Blender Detected`
                        : 'No Blender Detected'}
                    </span>
                  </div>
                  <button
                    onClick={scanBlenders}
                    disabled={scanStatus === 'scanning'}
                    className="p-1.5 rounded-lg text-c-text-2 hover:text-c-text
                      hover:bg-c-raised transition-colors disabled:opacity-30"
                    title="Rescan"
                  >
                    <RefreshCw size={12} className={scanStatus === 'scanning' ? 'animate-spin' : ''} />
                  </button>
                </div>

                {scanStatus === 'found' && (
                  <div className="space-y-1.5">
                    {instances.map(inst => (
                      <button
                        key={inst.port}
                        onClick={() => selectTarget(inst)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border
                          text-left transition-all
                          ${target?.port === inst.port
                            ? 'bg-c-accent/10 border-c-accent text-c-accent'
                            : 'bg-c-raised border-c-border text-c-text-2 hover:bg-c-hover hover:text-c-text'
                          }`}
                      >
                        <Monitor size={13} className="flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">
                            {basename(inst.file) || 'Untitled'}
                          </p>
                          <p className="text-[10px] text-c-text-3 mt-0.5">
                            Blender {inst.blender}
                          </p>
                        </div>
                        {target?.port === inst.port && <Check size={12} className="flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}

                {scanStatus === 'empty' && (
                  <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-c-text-2">How to enable:</p>
                    <ol className="text-[11px] text-c-text-4 space-y-1 list-decimal list-inside">
                      <li>Open Blender</li>
                      <li>Edit → Preferences → Add-ons</li>
                      <li>Enable addon <strong>ZeusPack Bridge</strong></li>
                      <li>Click refresh above</li>
                    </ol>
                  </div>
                )}
              </div>

              {/* ── Collections (from the project copy) ── */}
              {target && (
                <div>
                  <p className="text-xs font-medium text-c-text-2 mb-1.5">
                    Select Collection
                    {collections.length > 0 && (
                      <span className="text-c-text-4 font-normal ml-1">({collections.length})</span>
                    )}
                  </p>

                  {loadingCols && (
                    <div className="flex items-center gap-2 py-3 text-c-text-3 text-xs">
                      <Loader size={13} className="animate-spin" />
                      Loading collections...
                    </div>
                  )}

                  {!loadingCols && collections.length === 0 && !error && (
                    <p className="text-xs text-c-text-4 py-2">No collections found in this file.</p>
                  )}

                  {!loadingCols && collections.length > 0 && (
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {collections.map(col => (
                        <button
                          key={col}
                          onClick={() => setSelected(col)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all
                            flex items-center justify-between
                            ${selected === col
                              ? 'bg-c-accent text-c-on-accent'
                              : 'bg-c-raised text-c-text-2 hover:bg-c-hover hover:text-c-text border border-c-border'
                            }`}
                        >
                          <span className="font-medium">{col}</span>
                          {selected === col && <Check size={11} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
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
          <button onClick={requestClose}
            className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors">
            Cancel
          </button>
          {stage === 'ready' && (
            <button
              onClick={handleImport}
              disabled={!selected || !target || working || done}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
                bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
            >
              {done ? (
                <><Check size={12} /> {isAppend ? 'Appended!' : 'Linked!'}</>
              ) : working ? (
                <><Loader size={12} className="animate-spin" /> {isAppend ? 'Appending…' : 'Linking…'}</>
              ) : (
                <><Import size={12} /> {Verb} to Blender</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
