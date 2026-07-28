import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Clapperboard, Loader, Check, AlertCircle, RefreshCw } from 'lucide-react'
import FlaLibraryTree, { SELECTABLE } from '../shared/FlaLibraryTree'

// ── MODAL ──
export default function AnimateImportModal({ asset, onClose }) {
  const [status,   setStatus]   = useState('loading')  // loading | ready | disconnected | error
  const [items,    setItems]    = useState([])
  const [docName,  setDocName]  = useState('')
  const [selected, setSelected] = useState(null)
  const [importing, setImporting] = useState(false)
  const [imported,  setImported]  = useState(false)
  const [error,    setError]    = useState(null)

  const load = useCallback(async () => {
    setStatus('loading'); setError(null); setItems([]); setSelected(null)

    // NOTE: no pre-warm here. Opening the .fla in Animate just to browse it
    // made files pop open unprompted; the file now loads only when the user
    // actually imports. (zb_openFla still exists, just isn't called.)

    // 1) Read straight from the .fla on disk — instant, no Animate needed.
    const disk = await window.api.readFlaLibrary({ flaPath: asset.raw_path }).catch(() => ({ success: false }))
    if (disk.success) {
      setItems(disk.items || [])
      setDocName(disk.doc || '')
      setStatus('ready')
      return
    }

    // 2) Fallback (odd/legacy .fla): ask Animate via the bridge.
    const st = await window.api.animateStatus().catch(() => ({ connected: false }))
    if (!st.connected) {
      setStatus('error')
      setError(disk.error ? `Couldn't read the .fla directly (${disk.error}), and Animate isn't connected to fall back to.` : 'Animate not connected.')
      return
    }
    const res = await window.api.animateRun({
      action: 'get-fla-library',
      params: { flaPath: asset.raw_path },
    }).catch((e) => ({ success: false, error: e.message }))
    if (!res.success) { setStatus('error'); setError(res.error || res.message || 'Could not read library.'); return }

    setItems(res.data?.items || [])
    setDocName(res.data?.doc || '')
    setStatus('ready')
  }, [asset.raw_path])

  // Load ONCE per asset. Deliberately not depending on `onClose`: the parent
  // recreates that callback every render, and the app's background DB polling
  // re-renders periodically — which re-ran this effect and re-fired the
  // Animate pre-warm over and over while the user sat idle.
  useEffect(() => { load() }, [load])

  // Escape-to-close, registered once. onClose goes through a ref so a changing
  // callback identity can never re-trigger the loader above.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleImport = async () => {
    if (!selected) return
    setImporting(true); setError(null)
    const res = await window.api.animateRun({
      action: 'import-symbol',
      params: { flaPath: asset.raw_path, symbol: selected },
    }).catch((e) => ({ success: false, error: e.message }))
    setImporting(false)
    if (res.success) { setImported(true); setTimeout(onClose, 1200) }
    else setError(res.error || res.message || 'Import failed.')
  }

  const symbolCount = items.filter(i => SELECTABLE.has(i.type)).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Clapperboard size={15} className="text-c-accent" />
            <h2 className="text-sm font-bold text-c-text">Import Symbol to Animate</h2>
          </div>
          <button onClick={onClose} className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 overflow-hidden flex flex-col">

          <div className="bg-c-raised rounded-lg px-3 py-2 border border-c-border flex-shrink-0">
            <p className="text-[10px] text-c-text-2 mb-0.5">Source (.fla)</p>
            <p className="text-xs font-medium text-c-text truncate">{asset.name}</p>
          </div>

          <div className="flex items-center justify-between flex-shrink-0">
            <p className="text-xs font-medium text-c-text-2">
              {status === 'ready'
                ? <>Library {docName && <span className="text-c-text-4 font-normal">· {docName}</span>} <span className="text-c-text-4 font-normal">({symbolCount} symbols)</span></>
                : 'Library'}
            </p>
            <button onClick={load} disabled={status === 'loading'}
              className="p-1.5 rounded-lg text-c-text-2 hover:text-c-text hover:bg-c-raised transition-colors disabled:opacity-30"
              title="Reload">
              <RefreshCw size={12} className={status === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Tree */}
          <div className="border border-c-border rounded-lg bg-c-base/40 overflow-y-auto min-h-[140px] max-h-[42vh] p-1">
            {status === 'loading' && (
              <div className="flex items-center gap-2 py-6 justify-center text-c-text-3 text-xs">
                <Loader size={13} className="animate-spin" /> Reading Animate library…
              </div>
            )}
            {status === 'disconnected' && (
              <div className="px-3 py-4 text-[11px] text-c-text-3 space-y-1">
                <p className="font-semibold text-c-text-2">Animate not connected</p>
                <p>Open the <strong>ZeusPack Bridge</strong> panel in Animate (Window ▸ Extensions), then Reload.</p>
              </div>
            )}
            {status === 'error' && (
              <div className="flex items-start gap-2 px-3 py-3 text-[11px] text-c-error">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
            {status === 'ready' && items.length === 0 && (
              <p className="px-3 py-4 text-xs text-c-text-4">No items in this file's library.</p>
            )}
            {status === 'ready' && items.length > 0 && (
              <FlaLibraryTree items={items} selected={selected} onSelect={setSelected} />
            )}
          </div>

          {error && status === 'ready' && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30 flex-shrink-0">
              <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-c-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-c-border bg-c-base/40 flex-shrink-0">
          <span className="text-[10px] text-c-text-4 truncate flex-1">
            {selected ? selected : 'Select a symbol'}
          </span>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selected || importing || imported}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
              bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
          >
            {imported ? <><Check size={12} /> Imported!</>
              : importing ? <><Loader size={12} className="animate-spin" /> Importing…</>
              : <><Clapperboard size={12} /> Import</>}
          </button>
        </div>
      </div>
    </div>
  )
}
