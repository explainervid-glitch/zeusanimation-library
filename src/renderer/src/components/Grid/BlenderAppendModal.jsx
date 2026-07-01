import { useState, useEffect } from 'react'
import { X, ArrowRightFromLine, Loader, Check, AlertCircle, RefreshCw, Monitor } from 'lucide-react'

// ─── STATUS DOT ───────────────────────────────────────────────
function StatusDot({ status }) {
  const styles = {
    scanning: 'bg-yellow-400 animate-pulse',
    found:    'bg-green-400',
    empty:    'bg-red-400',
  }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles[status] || styles.empty}`} />
}

// Nama file dari full path
function basename(filePath) {
  if (!filePath) return 'Untitled'
  return filePath.split(/[\\/]/).pop()
}

export default function BlenderAppendModal({ asset, onClose }) {
  const [scanStatus,  setScanStatus]  = useState('scanning')  // scanning | found | empty
  const [instances,   setInstances]   = useState([])           // [{ port, file, blender }]
  const [target,      setTarget]      = useState(null)         // instance yang dipilih
  const [collections, setCollections] = useState([])
  const [loadingCols, setLoadingCols] = useState(false)
  const [selected,    setSelected]    = useState(null)
  const [appending,   setAppending]   = useState(false)
  const [appended,    setAppended]    = useState(false)
  const [error,       setError]       = useState(null)

  // ── Scan semua port Blender ──────────────────────────────────
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

    // Auto-select jika hanya 1
    if (found.length === 1) selectTarget(found[0])
  }

  // ── Pilih target Blender → load collections ──────────────────
  const selectTarget = async (instance) => {
    setTarget(instance)
    setCollections([])
    setSelected(null)
    setError(null)

    if (!asset.raw_path) {
      setError('Asset ini tidak punya raw file (.blend)')
      return
    }

    setLoadingCols(true)
    const result = await window.api.blenderGetCollections(asset.raw_path, instance.port)
    setLoadingCols(false)

    if (!result.success) {
      setError(result.error)
      return
    }

    setCollections(result.data || [])
    if (result.data?.length === 1) setSelected(result.data[0])
  }

  useEffect(() => {
    scanBlenders()
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Append ───────────────────────────────────────────────────
  const handleAppend = async () => {
    if (!selected || !target) return
    setAppending(true)
    setError(null)

    const result = await window.api.blenderAppend({
      filePath:   asset.raw_path,
      collection: selected,
      port:       target.port,
    })
    setAppending(false)

    if (result.success) {
      setAppended(true)
      setTimeout(onClose, 1200)
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border">
          <div className="flex items-center gap-2.5">
            <ArrowRightFromLine size={15} className="text-c-accent" />
            <h2 className="text-sm font-bold text-c-text">Append to Blender</h2>
          </div>
          <button onClick={onClose}
            className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* ── Asset info ── */}
          <div className="bg-c-raised rounded-lg px-3 py-2 border border-c-border">
            <p className="text-[10px] text-c-text-2 mb-0.5">Raw File</p>
            <p className="text-xs font-medium text-c-text truncate">{asset.name}</p>
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

            {/* Instance list */}
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
                        {/* Port {inst.port} ·  */}
                        Blender {inst.blender}
                      </p>
                    </div>
                    {target?.port === inst.port && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}

            {/* Offline guide */}
            {scanStatus === 'empty' && (
              <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-c-text-2">How to enable:</p>
                <ol className="text-[11px] text-c-text-4 space-y-1 list-decimal list-inside">
                  <li>Open Blender</li>
                  <li>Edit → Preferences → Add-ons</li>
                  <li>Install → select <code className="bg-c-hover px-1 rounded">zeuspack_bridge.py</code></li>
                  <li>Enable addon <strong>ZeusPack Bridge</strong></li>
                  <li>Click refresh above</li>
                </ol>
              </div>
            )}
          </div>

          {/* ── Collections ── */}
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-c-border bg-c-base/40">
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors">
            Cancel
          </button>
          <button
            onClick={handleAppend}
            disabled={!selected || !target || appending || appended}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
              bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
          >
            {appended ? (
              <><Check size={12} /> Appended!</>
            ) : appending ? (
              <><Loader size={12} className="animate-spin" /> Appending...</>
            ) : (
              <><ArrowRightFromLine size={12} /> Append to Blender</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}