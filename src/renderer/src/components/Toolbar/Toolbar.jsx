import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Settings, ChevronDown, Check, Package, Search, X, Astroid, RefreshCw, Sparkles, Columns2, FilePlus, MoreVertical, Combine } from 'lucide-react'
import useAssetStore    from '../../store/useAssetStore'
import useSettingsStore from '../../store/useSettingsStore'
import useBatchStore    from '../../store/useBatchStore'
import useLayoutStore   from '../../store/useLayoutStore'
import useCompileStore  from '../../store/useCompileStore'
import SettingsModal    from './SettingsModal'
import AddModal         from './AddModal'
import BatchTaggerModal from './BatchTaggerModal'
import WindowControls   from './WindowControls'
import icon from '../../assets/icon.png'

const PACK_LIST = [
  { label: '2D', index: 0 },
  { label: '3D', index: 1 },
  // { label: '-', index: 2 },
]

const TYPE_LABEL = {
  background:  'Background',
  character:   'Character',
  animation:   'Movement',
  inspiration: 'Inspiration',
}

// ─── PACK DROPDOWN ────────────────────────────────────────────
function PackDropdown() {
  const { activePackIndex, switchPack, scanning, treeLoading } = useAssetStore()
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activePack = PACK_LIST[activePackIndex] ?? PACK_LIST[0]
  const isBusy     = scanning || treeLoading

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !isBusy && setOpen(o => !o)}
        disabled={isBusy}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium
          border transition-all select-none
          ${open
            ? 'bg-c-hover border-c-accent text-c-text'
            : 'bg-c-raised border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text'
          }
          ${isBusy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <Package size={13} className="text-c-accent flex-shrink-0" />
        <span className="max-w-[140px] truncate">{activePack.label}</span>
        <ChevronDown size={11} className={`flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50
          bg-c-surface border border-c-border rounded-xl shadow-xl
          min-w-[180px] overflow-hidden py-1"
        >
          {PACK_LIST.map((pack) => (
            <button
              key={pack.index}
              onClick={() => { setOpen(false); if (pack.index !== activePackIndex) switchPack(pack.index) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all
                ${pack.index === activePackIndex
                  ? 'bg-c-accent/10 text-c-accent'
                  : 'text-c-text-2 hover:bg-c-raised hover:text-c-text'
                }`}
            >
              <span className="w-3 flex-shrink-0">
                {pack.index === activePackIndex && <Check size={11} />}
              </span>
              <span className="text-xs font-medium">{pack.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SEARCH BAR ───────────────────────────────────────────────
function SearchBar() {
  const {
    selectedCategory, selectedStyleId,
    searchQuery, setSearchQuery, clearSearch,
    searchMode, toggleSearchMode,
    searchLoading, isSearchMode, searchResults, error,
  } = useAssetStore()

  const [localQuery, setLocalQuery] = useState('')
  const inputRef   = useRef(null)
  const debounceRef = useRef(null)

  const isAiMode = searchMode === 'semantic'

  // Sync jika searchQuery di-clear dari luar (e.g. pilih category lain)
  useEffect(() => {
    if (!searchQuery) setLocalQuery('')
  }, [searchQuery])

  // Debounce 300ms
  const handleChange = useCallback((e) => {
    const val = e.target.value
    setLocalQuery(val)

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(val)
    }, 300)
  }, [setSearchQuery])

  const handleClear = () => {
    setLocalQuery('')
    clearSearch()
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') handleClear()
  }

  const handleToggleAi = () => {
    setLocalQuery('')
    toggleSearchMode()
    inputRef.current?.focus()
  }

  // Scope label: "Background · 2D" saat selectedCategory ada
  const scopeLabel = selectedCategory
    ? `${TYPE_LABEL[selectedCategory.type] || selectedCategory.type}`
    : null

  // AI mode only needs a STYLE selected (not a category)
  const isDisabled = isAiMode ? selectedStyleId == null : !selectedCategory

  const placeholder = isAiMode
    ? (selectedStyleId != null ? 'AI Search — describe what you need...' : 'Select a style first')
    : (scopeLabel ? `Search in ${scopeLabel}...` : 'Select a category first')

  return (
    <div className="flex items-center gap-1.5 flex-1 max-w-xs" style={{ WebkitAppRegion: 'no-drag' }}>
      {/* AI Search toggle */}
      <button
        onClick={handleToggleAi}
        title={isAiMode ? 'AI Search active — click to use keyword search' : 'Toggle AI Search (semantic, style-wide)'}
        className={`flex-shrink-0 p-1.5 rounded-lg border transition-all
          ${isAiMode
            ? 'bg-c-accent/15 border-c-accent text-c-accent shadow-sm shadow-c-accent/10'
            : 'bg-c-raised border-c-border-2 text-c-text-3 hover:border-c-border hover:text-c-text'
          }`}
      >
        <Sparkles size={13} />
      </button>

      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border flex-1
        transition-all
        ${isDisabled
          ? 'bg-c-raised/ border-c-text-3 opacity-100 cursor-not-allowed'
          : isSearchMode
            ? isAiMode
              ? 'bg-c-raised border-c-accent shadow-sm shadow-c-accent/10'
              : 'bg-c-raised border-c-accent shadow-sm shadow-c-accent/10'
            : 'bg-c-raised border-c-border-2 hover:border-c-border focus-within:border-c-accent'
        }`}
      >
        {/* Icon */}
        {searchLoading
          ? <div className="w-3 h-3 border border-c-border-2 border-t-c-accent rounded-full animate-spin flex-shrink-0" />
          : isAiMode
            ? <Sparkles size={13} className={`flex-shrink-0 ${isSearchMode ? 'text-c-accent' : 'text-c-text-4'}`} />
            : <Search size={13} className={`flex-shrink-0 ${isSearchMode ? 'text-c-accent' : 'text-c-text-4'}`} />
        }

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={localQuery}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-c-text placeholder:text-c-text-3
            outline-none min-w-0 disabled:cursor-not-allowed"
        />

        {/* Clear */}
        {localQuery && (
          <button
            onClick={handleClear}
            className="flex-shrink-0 text-c-text-4 hover:text-c-text transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Result count badge / error */}
      {isSearchMode && !searchLoading && !error && (
        <span className="text-[10px] text-c-text-4 flex-shrink-0 tabular-nums">
          {searchResults.length} found
        </span>
      )}
      {error && isAiMode && (
        <span className="text-[10px] text-red-400 flex-shrink-0 truncate max-w-[120px]" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}

// ─── ADD DROPDOWN ─────────────────────────────────────────────
function AddDropdown({ disabled, onAddAsset, onBatchTag, batchDisabled, batchTitle }) {
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = (fn) => { setOpen(false); fn() }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
          border transition-all
          ${disabled
            ? 'bg-c-raised text-c-text-4 border-c-border cursor-not-allowed'
            : 'bg-c-accent text-c-on-accent border-c-accent hover:bg-c-accent-h font-semibold'
          }`}
      >
        <Plus size={13} />
        Add
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50
          bg-c-surface border border-c-border rounded-xl shadow-xl
          min-w-[210px] overflow-hidden py-1"
        >
          <button
            onClick={() => { if (!batchDisabled) pick(onBatchTag) }}
            disabled={batchDisabled}
            title={batchTitle}
            className="w-full flex items-start gap-2.5 px-3 py-2 text-left
              text-c-text-2 hover:bg-c-raised hover:text-c-text transition-all
              disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Astroid size={14} className="text-c-accent flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium">Batch Tag</p>
              <p className="text-[10px] text-c-text-4">Tag multiple assets at once</p>
            </div>
          </button>
          <button
            onClick={() => pick(onAddAsset)}
            className="w-full flex items-start gap-2.5 px-3 py-2 text-left
              text-c-text-2 hover:bg-c-raised hover:text-c-text transition-all"
          >
            <FilePlus size={14} className="text-c-accent flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium">Asset</p>
              <p className="text-[10px] text-c-text-4">Add an asset to a category</p>
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── OVERFLOW MENU (Split view / Sync / Settings) ─────────────
function MenuDropdown({ splitOpen, onToggleSplit, onSync, syncing, synced, syncDisabled, onSettings }) {
  const [open, setOpen] = useState(false)
  const ref             = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const item = 'w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-all'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="More options"
        className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-all
          ${open
            ? 'bg-c-hover border-c-accent text-c-text'
            : 'bg-c-raised text-c-text-3 hover:bg-c-hover hover:text-c-text border-c-border-2'
          }`}
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50
          bg-c-surface border border-c-border rounded-xl shadow-xl
          min-w-[190px] overflow-hidden py-1"
        >
          {/* Split view — toggles, keeps menu open feedback via check */}
          <button
            onClick={() => { setOpen(false); onToggleSplit() }}
            className={`${item} ${splitOpen ? 'text-c-accent' : 'text-c-text-2 hover:bg-c-raised hover:text-c-text'}`}
          >
            <Columns2 size={14} className="flex-shrink-0" />
            <span className="flex-1">Split view</span>
            {splitOpen && <Check size={13} className="flex-shrink-0" />}
          </button>

          {/* Sync — stays open so the spinner / "Synced" state is visible */}
          <button
            onClick={onSync}
            disabled={syncDisabled}
            title="Sync latest changes from NAS (auto every 15s)"
            className={`${item} disabled:opacity-40 disabled:cursor-not-allowed
              ${synced ? 'text-green-400' : 'text-c-text-2 hover:bg-c-raised hover:text-c-text'}`}
          >
            <RefreshCw size={14} className={`flex-shrink-0 ${syncing ? 'animate-spin' : ''}`} />
            <span className="flex-1">{syncing ? 'Syncing…' : synced ? 'Synced' : 'Sync from NAS'}</span>
          </button>

          <div className="my-1 border-t border-c-border" />

          {/* Settings */}
          <button
            onClick={() => { setOpen(false); onSettings() }}
            className={`${item} text-c-text-2 hover:bg-c-raised hover:text-c-text`}
          >
            <Settings size={14} className="flex-shrink-0" />
            <span className="flex-1">Settings</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ─── TOOLBAR ──────────────────────────────────────────────────
export default function Toolbar() {
  const { scanning, selectedCategory, assets, checkDbUpdated, activePackIndex } = useAssetStore()
  const { openSettings, blenderImportEnabled } = useSettingsStore()
  const { isBatchMode, selectedIds, enterBatchMode, exitBatchMode } = useBatchStore()
  const { splitOpen, toggleSplit } = useLayoutStore()
  const { isCompileMode, toggleCompileMode } = useCompileStore()

  // "Compile" is exclusive to the 3D pack, and only when Import to Blender is on.
  const canCompile = activePackIndex === 1 && blenderImportEnabled
  const [showAddModal, setShowAddModal]   = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [refreshing, setRefreshing]       = useState(false)
  const [refreshed, setRefreshed]         = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    const updated = await checkDbUpdated()
    setRefreshing(false)
    setRefreshed(true)
    setTimeout(() => setRefreshed(false), 2000)
    if (updated) console.log('[Toolbar] DB refreshed from NAS')
  }

  return (
    <>
      <header
        className="h-12 bg-c-surface border-b border-c-border flex items-center px-4 gap-3 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' }}
      >

        {/* Logo + Pack switcher */}
        <div className="flex items-center gap-2.5 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' }}>
          <img src={icon} alt="Zeus" style={{ width: 25, height: 25 }} />
          <span className="text-sm font-bold text-c-text tracking-tight">ZeusPack</span>
          <span className="w-px h-4 bg-c-border-2" />
          <PackDropdown />
        </div>

        {/* Search — center, flex-1 */}
        <div className="flex-1 flex justify-center">
          <SearchBar />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' }}>

          {/* Batch Mode: ACTIVE - Cancel & Start Tagging buttons */}
          {isBatchMode && (
            <>
              <button
                onClick={() => exitBatchMode()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  bg-c-raised text-c-text border border-c-border-2
                  hover:bg-c-hover transition-all"
              >
                Cancel
              </button>

              <button
                onClick={() => setShowBatchModal(true)}
                disabled={selectedIds.size === 0}
                title={selectedIds.size === 0 ? 'Select assets first via checkboxes' : 'Review and start tagging'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                  border transition-all
                  ${selectedIds.size === 0
                    ? 'bg-c-accent/50 text-c-on-accent/50 border-c-accent cursor-not-allowed'
                    : 'bg-c-accent text-c-on-accent border-c-accent hover:bg-c-accent-h'
                  }`}
              >
                <Astroid size={13} />
                Start Tagging ({selectedIds.size})
              </button>
            </>
          )}

          {/* Compile toggle — 3D pack + Import to Blender only */}
          {canCompile && (
            <button
              onClick={toggleCompileMode}
              title={isCompileMode ? 'Exit Compile mode' : 'Compile mode — pick a Character + a Movement'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                border transition-all
                ${isCompileMode
                  ? 'bg-c-accent/15 border-c-accent text-c-accent'
                  : 'bg-c-raised text-c-text-2 border-c-border-2 hover:bg-c-hover hover:text-c-text'
                }`}
            >
              <Combine size={13} />
              Compile
            </button>
          )}

          <AddDropdown
            disabled={scanning}
            onAddAsset={() => setShowAddModal(true)}
            onBatchTag={() => enterBatchMode()}
            batchDisabled={isBatchMode || !selectedCategory || assets.length === 0 || scanning}
            batchTitle={
              isBatchMode ? 'Already tagging'
              : !selectedCategory ? 'Select a category first'
              : assets.length === 0 ? 'No assets in this category'
              : scanning ? 'Cannot tag while scanning'
              : 'Tag multiple assets at once'
            }
          />

          {/* Overflow menu — Split view / Sync / Settings */}
          <MenuDropdown
            splitOpen={splitOpen}
            onToggleSplit={toggleSplit}
            onSync={handleRefresh}
            syncing={refreshing}
            synced={refreshed}
            syncDisabled={refreshing || scanning}
            onSettings={openSettings}
          />

        </div>

        {/* Window controls — flush to the top-right corner */}
        <WindowControls />
      </header>

      <AddModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} />
      <SettingsModal />
      <BatchTaggerModal isOpen={showBatchModal} onClose={() => setShowBatchModal(false)} />
    </>
  )
}