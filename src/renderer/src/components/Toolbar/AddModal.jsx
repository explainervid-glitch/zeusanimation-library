import { useState, useEffect, useRef } from 'react'
import { X, ChevronLeft, Check, AlertCircle } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import useSettingsStore from '../../store/useSettingsStore'

// "Ae" is not a separate kind of asset — it is a Movement whose raw file is an
// .aep instead of a .fla. It lands in the same folder, the same category list
// and the same style_type; only the template it is copied from differs.
const ASSET_TYPES = [
  { id: 'background',  label: 'Background'  },
  { id: 'image',       label: 'Character'   },
  { id: 'movement',    label: 'Movement'    },
  { id: 'inspiration', label: 'Inspiration' },
  { id: 'movement_ae', label: 'Ae', assetType: 'movement', templateId: 'ae' },
]

const typeDef = (id) => ASSET_TYPES.find(t => t.id === id)
// The value create-asset expects — 'movement_ae' is a UI-only id.
const toAssetType = (id) => typeDef(id)?.assetType ?? id

// ─── SHARED: STYLE DROPDOWN ───────────────────────────────────
function StyleDropdown({ styleNames, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-c-text-2 mb-1.5">Style</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-xs
          bg-c-raised border border-c-border-2 text-c-text
          focus:outline-none focus:border-c-accent transition-colors"
      >
        <option value="">— Select Style —</option>
        {Object.entries(styleNames).map(([suffix, obj]) => (
          <option key={suffix} value={suffix}>
            {obj.name || `Style ${suffix}`}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── SHARED: ASSET TYPE PILLS ─────────────────────────────────
function AssetTypePills({ value, onChange, disabledIds = {} }) {
  return (
    <div>
      <label className="block text-xs font-medium text-c-text-2 mb-1.5">Asset Type</label>
      <div className="flex flex-wrap gap-2">
        {ASSET_TYPES.map(t => {
          const reason = disabledIds[t.id]
          return (
            <button
              key={t.id}
              onClick={() => !reason && onChange(t.id)}
              disabled={!!reason}
              title={reason || undefined}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${value === t.id
                  ? 'bg-c-accent text-c-on-accent'
                  : 'bg-c-raised border border-c-border-2 text-c-text hover:border-c-accent/50'
                }
                ${reason ? 'opacity-40 cursor-not-allowed hover:border-c-border-2' : ''}`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── ADD ASSET ────────────────────────────────────────────────
function AddAssetForm({ styleNames, defaultStyle, onClose }) {
  const { tree, selectedCategory } = useAssetStore()

  // Auto-select type dari selectedCategory.type
  const TYPE_MAP = { background: 'background', character: 'image', animation: 'movement', inspiration: 'inspiration' }
  const defaultType = selectedCategory?.type ? TYPE_MAP[selectedCategory.type] : null
  const defaultCat  = selectedCategory?.name || ''

  const [selectedStyle, setSelectedStyle] = useState(defaultStyle || '')
  const [selectedType,  setSelectedType]  = useState(defaultType || null)
  const [categories,    setCategories]    = useState([])
  const [selectedCat,   setSelectedCat]   = useState(defaultCat)
  const [fileName,      setFileName]      = useState('')
  const [detail,        setDetail]        = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [success, setSuccess] = useState(false)

  // The Ae pill is only usable once its template path is set — create-asset
  // would otherwise fail on a missing template, which reads as a bug rather
  // than as unfinished setup.
  const aeTemplatePath = useSettingsStore((s) =>
    s.templatePaths.find((t) => t.id === 'ae')?.path || '')
  const disabledTypes = aeTemplatePath
    ? {}
    : { movement_ae: 'Set the "Ae" template in Preferences ▸ Template Files first' }

  // Type map untuk lookup di tree
  const TYPE_TO_TREE = { background: 'background', image: 'character', movement: 'animation', movement_ae: 'animation', inspiration: 'inspiration' }

  // Load categories saat style atau type berubah
  useEffect(() => {
    if (!selectedStyle || !selectedType) {
      setCategories([])
      if (selectedCat) setSelectedCat('')
      return
    }

    const styleId  = Number(selectedStyle) || 0
    const treeType = TYPE_TO_TREE[selectedType]
    const style    = tree.find(s => s.id === styleId)
    const typeData = style?.types?.find(t => t.type === treeType)

    if (typeData?.categories) {
      const catList = typeData.categories.map(c => c.name)
      setCategories(catList)
      if (defaultCat && catList.includes(defaultCat) && selectedCat !== defaultCat) {
        setSelectedCat(defaultCat)
      }
    } else {
      setCategories([])
      setSelectedCat('')
    }
  }, [selectedStyle, selectedType, tree, defaultCat])

  const handleCreate = async () => {
    if (!selectedStyle || !selectedType || !selectedCat || !fileName.trim()) {
      setError('Fill all fields first')
      return
    }
    setLoading(true); setError(null)
    try {
      const result = await window.api.createAsset({
        styleSuffix:  selectedStyle,
        assetType:    toAssetType(selectedType),
        categoryName: selectedCat,
        fileName:     fileName.trim(),
        detail:       detail.trim(),
        templateId:   typeDef(selectedType)?.templateId,
      })
      if (result.success) {
        setSuccess(true)
        await useAssetStore.getState().loadTree()
        setTimeout(onClose, 800)
      } else if (result.duplicate) {
        setError(`Asset "${fileName}" already exists — please choose a different name`)
      } else {
        setError(result.error || 'Failed to create asset')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">

      <StyleDropdown styleNames={styleNames} value={selectedStyle} onChange={v => { setSelectedStyle(v); setError(null) }} />
      <AssetTypePills
        value={selectedType}
        onChange={v => { setSelectedType(v); setError(null) }}
        disabledIds={disabledTypes}
      />

      {/* Category */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="block text-xs font-medium text-c-text-2">Category</label>
          {selectedCat === defaultCat && defaultCat && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-c-accent/20 text-c-accent font-medium">auto-filled</span>
          )}
        </div>
        <select
          value={selectedCat}
          onChange={e => setSelectedCat(e.target.value)}
          disabled={!selectedStyle || !selectedType || categories.length === 0}
          className="w-full px-3 py-2 rounded-lg text-xs
            bg-c-raised border border-c-border-2 text-c-text
            focus:outline-none focus:border-c-accent transition-colors
            disabled:opacity-40"
        >
          <option value="">
            {!selectedStyle || !selectedType
              ? '— Select style & type first —'
              : categories.length === 0
                ? '— No categories available —'
                : '— Select category —'
            }
          </option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="border-t border-c-border" />

      {/* File Name */}
      <div>
        <label className="block text-xs font-medium text-c-text-2 mb-1.5">
          File Name <span className="text-c-error">*</span>
        </label>
        <input
          type="text"
          value={fileName}
          onChange={e => { setFileName(e.target.value); setError(null) }}
          placeholder="e.g. Office_Desk_01"
          className="w-full px-3 py-2 rounded-lg text-xs
            bg-c-raised border border-c-border-2 text-c-text placeholder-c-text-4
            focus:outline-none focus:border-c-accent transition-colors"
          disabled={loading}
          autoFocus
        />
        <p className="text-[10px] text-c-text-4 mt-1">
          Tidak boleh ada spasi. File akan diberi extension otomatis.
        </p>
      </div>

      {/* Detail */}
      <div>
        <label className="block text-xs font-medium text-c-text-2 mb-1.5">Detail (Optional)</label>
        <input
          type="text"
          value={detail}
          onChange={e => setDetail(e.target.value)}
          placeholder="Short description..."
          className="w-full px-3 py-2 rounded-lg text-xs
            bg-c-raised border border-c-border-2 text-c-text placeholder-c-text-4
            focus:outline-none focus:border-c-accent transition-colors"
          disabled={loading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
          <AlertCircle size={13} className="text-c-error flex-shrink-0" />
          <p className="text-[11px] text-c-error">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={loading || success || !selectedStyle || !selectedType || !selectedCat || !fileName.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
            bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-50"
        >
          {success ? <><Check size={12} /> Created!</> : loading ? 'Creating...' : 'Create Asset'}
        </button>
      </div>
    </div>
  )
}

// ─── MAIN MODAL ───────────────────────────────────────────────
export default function AddModal({ isOpen, onClose }) {
  const { selectedCategory } = useAssetStore()
  const [styleNames, setStyleNames] = useState({})
  const modalRef = useRef(null)

  // Auto-detect style aktif dari sidebar
  const defaultStyle = selectedCategory?.styleId != null
    ? String(selectedCategory.styleId)
    : null

  // Load style names saat buka
  useEffect(() => {
    if (!isOpen) return
    window.api.getStyleNames().then(result => {
      if (result.success) setStyleNames(result.data)
    }).catch(() => {})
  }, [isOpen])

  const handleClose = () => onClose()

  // Klik di luar
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) handleClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  // Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-md">
      <div
        ref={modalRef}
        className="bg-c-surface border border-c-border rounded-xl shadow-2xl
          p-6 w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-c-text">Add Asset</h2>
          <button onClick={handleClose} className="text-c-text-3 hover:text-c-text transition-colors">
            <X size={16} />
          </button>
        </div>

        <AddAssetForm
          styleNames={styleNames}
          defaultStyle={defaultStyle}
          onClose={handleClose}
        />
      </div>
    </div>
  )
}