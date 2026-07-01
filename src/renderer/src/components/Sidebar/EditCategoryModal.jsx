import { useState, useEffect, useRef } from 'react'
import { X, Plus, Check, AlertCircle, Trash2, Loader } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'

const TYPE_LABEL = {
  background:  'Background',
  character:   'Character',
  animation:   'Movement',
  inspiration: 'Inspiration',
}

// assetType yang dikirim ke IPC (kebalikan dari TYPE_TO_TREE di AddModal)
const TYPE_TO_ASSET = {
  background:  'background',
  character:   'image',
  animation:   'movement',
  inspiration: 'inspiration',
}

export default function EditCategoryModal({ typeData, styleId, onClose }) {
  const { loadTree } = useAssetStore()

  // ── State ─────────────────────────────────────────────────────
  const [styleNames,  setStyleNames]  = useState({})
  const [newCatName,  setNewCatName]  = useState('')
  const [adding,      setAdding]      = useState(false)
  const [addError,    setAddError]    = useState(null)
  const [addSuccess,  setAddSuccess]  = useState(false)

  // Delete confirm: null | categoryId
  const [confirmId,   setConfirmId]   = useState(null)
  const [deleting,    setDeleting]    = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const inputRef  = useRef(null)
  const modalRef  = useRef(null)

  const styleSuffix = styleId === 0 ? '' : String(styleId)
  const assetType   = TYPE_TO_ASSET[typeData.type] || typeData.type

  useEffect(() => {
    window.api.getStyleNames().then(r => {
      if (r.success) setStyleNames(r.data)
    }).catch(() => {})
    setTimeout(() => inputRef.current?.focus(), 60)
  }, [])

  // Escape & click outside
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (confirmId) setConfirmId(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, confirmId])

  useEffect(() => {
    const onClick = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [onClose])

  // ── Add ───────────────────────────────────────────────────────
  const handleAdd = async () => {
    const name = newCatName.trim()
    if (!name) return
    setAdding(true); setAddError(null)
    try {
      const result = await window.api.addCategory({
        styleSuffix,
        assetType,
        categoryName: name,
      })
      if (result.success) {
        setAddSuccess(true)
        setNewCatName('')
        await loadTree()
        setTimeout(() => setAddSuccess(false), 1500)
      } else {
        setAddError(result.error || 'Failed to add')
      }
    } catch (err) {
      setAddError(err.message)
    } finally {
      setAdding(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = async (cat) => {
    setDeleting(true); setDeleteError(null)
    try {
      const result = await window.api.deleteCategory({
        styleSuffix,
        assetType,
        categoryName: cat.name,
        categoryId:   cat.id,
      })
      if (result.success) {
        setConfirmId(null)
        await loadTree()
      } else {
        setDeleteError(result.error || 'Failed to delete')
        setConfirmId(null)
      }
    } catch (err) {
      setDeleteError(err.message)
      setConfirmId(null)
    } finally {
      setDeleting(false)
    }
  }

  const styleName  = styleNames[String(styleId)]?.name || `Style ${styleId}`
  const categories = typeData.categories.filter(c => c.name !== '⚠ Uncategorized')
  const hasUncat   = typeData.categories.some(c => c.name === '⚠ Uncategorized')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="bg-c-surface border border-c-border rounded-xl shadow-2xl w-full max-w-xs mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-c-border flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-c-text">Edit Categories</p>
            <p className="text-[10px] text-c-text-4 mt-0.5">
              {TYPE_LABEL[typeData.type]} · {styleName}
            </p>
          </div>
          <button onClick={onClose} className="text-c-text-3 hover:text-c-text transition-colors p-1 -mr-1">
            <X size={14} />
          </button>
        </div>

        {/* ── Category list ───────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-3 py-2 space-y-0.5 min-h-0">
          {categories.length === 0 && !hasUncat && (
            <p className="text-[11px] text-c-text-4 text-center py-3">No categories yet</p>
          )}

          {categories.map(cat => {
            const isConfirming = confirmId === cat.id
            return (
              <div
                key={cat.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg group
                  transition-colors
                  ${isConfirming
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-c-raised/60 hover:bg-c-raised border border-transparent hover:border-c-border/50'
                  }`}
              >
                {!isConfirming ? (
                  <>
                    {/* Name + count */}
                    <span className="flex-1 text-[11px] text-c-text truncate">{cat.name}</span>
                    <span className="text-[10px] text-c-text-4 tabular-nums flex-shrink-0">
                      {cat.asset_count ?? 0}
                    </span>

                    {/* Delete trigger */}
                    <button
                      onClick={() => { setConfirmId(cat.id); setDeleteError(null) }}
                      disabled={deleting}
                      className="flex-shrink-0 p-0.5 rounded text-c-text-4
                        opacity-0 group-hover:opacity-100
                        hover:text-red-400 transition-all"
                      title="Delete category"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                ) : (
                  /* Confirm row */
                  <>
                    <span className="flex-1 text-[11px] text-red-400 truncate font-medium">
                      Delete "{cat.name}"?
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleDelete(cat)}
                        disabled={deleting}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                          bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        {deleting ? <Loader size={10} className="animate-spin" /> : <Trash2 size={10} />}
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        disabled={deleting}
                        className="px-2 py-0.5 rounded text-[10px] text-c-text-3
                          bg-c-raised hover:text-c-text transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {/* Uncategorized (read-only) */}
          {hasUncat && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg
              bg-amber-500/8 border border-amber-500/20 mt-1">
              <span className="flex-1 text-[11px] text-amber-400/80 truncate">⚠ Uncategorized</span>
              <span className="text-[10px] text-amber-400/50">auto</span>
            </div>
          )}

          {/* Delete error */}
          {deleteError && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg
              bg-c-error-bg/20 border border-c-error/30 mt-1">
              <AlertCircle size={11} className="text-c-error flex-shrink-0" />
              <p className="text-[10px] text-c-error">{deleteError}</p>
            </div>
          )}
        </div>

        {/* ── Add new ─────────────────────────────────────────── */}
        <div className="px-3 py-3 border-t border-c-border bg-c-base/30 flex-shrink-0 space-y-2">
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={newCatName}
              onChange={e => { setNewCatName(e.target.value); setAddError(null) }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="New category name..."
              disabled={adding}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs
                bg-c-raised border border-c-border-2 text-c-text placeholder-c-text-4
                focus:outline-none focus:border-c-accent transition-colors"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newCatName.trim()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold
                bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all
                disabled:opacity-40 flex-shrink-0"
            >
              {adding ? (
                <Loader size={11} className="animate-spin" />
              ) : addSuccess ? (
                <Check size={11} />
              ) : (
                <Plus size={11} />
              )}
            </button>
          </div>

          {addError && (
            <div className="flex items-center gap-1.5 p-2 rounded-lg bg-c-error-bg/20 border border-c-error/30">
              <AlertCircle size={11} className="text-c-error flex-shrink-0" />
              <p className="text-[10px] text-c-error">{addError}</p>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="px-3 py-2.5 border-t border-c-border flex-shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-c-text-4">
            Assets in deleted categories → Uncategorized
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg text-xs font-medium
              bg-c-raised border border-c-border-2 text-c-text-2
              hover:bg-c-hover hover:text-c-text transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}