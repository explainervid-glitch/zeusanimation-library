import { useState } from 'react'
import useAssetStore from '../../store/useAssetStore'
import useBatchStore from '../../store/useBatchStore'
import AssetCard from './AssetCard'
import { Layers, MousePointerClick, RefreshCw, Search } from 'lucide-react'

const TYPE_LABEL = {
  background: 'Background',
  character:  'Character',
  animation:  'Animation',
}

const TYPE_MIN_WIDTH = {
  background: '240px',
  character:  '160px',
  animation:  '140px',
}

const DEFAULT_MIN_WIDTH = '160px'

export default function AssetGrid() {
  const {
    assets, selectedCategory, selectedStyleId,
    assetsLoading, treeLoading,
    packNeedsRescan, rescan, scanning,
    searchQuery, searchResults, searchLoading, isSearchMode, searchMode,
  } = useAssetStore()

  const { isBatchMode, selectedIds, statusMap, toggleSelect, selectAll, deselectAll } = useBatchStore()

  const [gridScale, setGridScale] = useState(1)

  // ── Tentukan data dan loading state ──────────────────────────
  const displayAssets = isSearchMode ? searchResults : assets
  const isLoading     = assetsLoading || (isSearchMode && searchLoading)
  const isAiSearch    = isSearchMode && searchMode === 'semantic'

  // ── Pack belum di-scan ────────────────────────────────────────
  if (packNeedsRescan) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-c-text-4">
        <Layers size={40} strokeWidth={1} />
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-c-text-2">Pack ini belum punya database</p>
          <p className="text-xs text-c-text-4">Klik Rescan untuk scan folder dan build database pertama kali</p>
        </div>
        <button
          onClick={rescan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-50"
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Rescan Sekarang'}
        </button>
      </div>
    )
  }

  // ── Loading tree ──────────────────────────────────────────────
  if (treeLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-c-text-3 text-sm">
        <div className="w-4 h-4 border border-c-border-2 border-t-c-accent rounded-full animate-spin" />
        Memuat pack...
      </div>
    )
  }

  // ── Belum pilih category (AI Search bisa jalan dengan style saja) ──
  if (!selectedCategory && !(isAiSearch && selectedStyleId != null)) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-c-text-4">
        <MousePointerClick size={40} strokeWidth={1} />
        <p className="text-sm">Select a category at the sidebar</p>
      </div>
    )
  }

  // ── Loading assets / search ───────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-c-text-3 text-sm">
        <div className="w-4 h-4 border border-c-border-2 border-t-c-accent rounded-full animate-spin" />
        {isSearchMode ? 'Searching...' : 'Loading assets...'}
      </div>
    )
  }

  // In AI Search mode without a category, results are mixed types —
  // fall back to a neutral default width and let each card pick its own type.
  const type         = selectedCategory?.type ?? null
  const baseMinWidth = parseInt(TYPE_MIN_WIDTH[type] || DEFAULT_MIN_WIDTH)
  const minWidth     = `${Math.round(baseMinWidth * gridScale)}px`
  const styleTypeId  = selectedCategory?.style_type_id ?? selectedCategory?.styleTypeId ?? null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-c-border flex items-center gap-2">
        <span className="text-xs text-c-text-4 uppercase tracking-widest">
          {isAiSearch && !selectedCategory ? 'All Types' : (TYPE_LABEL[type] || type)}
        </span>
        <span className="text-c-text-4">/</span>
        <span className="text-sm font-semibold text-c-text">
          {isSearchMode
            ? (isAiSearch ? 'AI Search Results' : 'Search Results')
            : selectedCategory.name}
        </span>

        {/* Search context badge */}
        {isSearchMode && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium
            bg-c-accent/15 text-c-accent border border-c-accent/30">
            "{searchQuery}"
          </span>
        )}

        {/* Count */}
        {isSearchMode ? (
          <span className="ml-auto text-xs text-c-text-4">
            {searchResults.length} results
          </span>
        ) : (
          <span className="ml-auto text-xs text-c-text-4">{assets.length} Assets</span>
        )}

        {/* Batch mode selection count */}
        {isBatchMode && (
          <>
            <span className="ml-2 px-2 py-1 rounded-full text-xs font-medium
              bg-c-accent/20 text-c-accent border border-c-accent/30">
              {selectedIds.size} selected
            </span>

            {/* Select All / Deselect All buttons */}
            <div className="ml-2 flex items-center gap-1.5">
              <button
                onClick={() => selectAll(displayAssets.map(a => a.id))}
                disabled={selectedIds.size === displayAssets.length}
                className="px-2 py-1 text-[11px] font-medium rounded
                  bg-c-accent/20 text-c-accent border border-c-accent/30
                  hover:bg-c-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Select All
              </button>
              
              <button
                onClick={() => deselectAll()}
                disabled={selectedIds.size === 0}
                className="px-2 py-1 text-[11px] font-medium rounded
                  bg-c-text-4/20 text-c-text-3 border border-c-text-4/30
                  hover:bg-c-text-4/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
          </>
        )}

        {/* Slider */}
        <div className="flex items-center gap-2 ml-2 pl-3 border-l border-c-border shrink-0">
          <input
            type="range"
            min="0.5" max="1.5" step="0.1"
            value={gridScale}
            onChange={(e) => setGridScale(parseFloat(e.target.value))}
            className="w-20 h-1.5 bg-c-border-2 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
              [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-c-accent [&::-webkit-slider-thumb]:cursor-pointer"
            title="Adjust card size"
          />
          <span className="text-[10px] text-c-text-4 w-6 text-right tabular-nums">
            {Math.round(gridScale * 100)}%
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {displayAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-c-text-4">
            {isSearchMode ? (
              <>
                <Search size={36} strokeWidth={1} />
                <p className="text-sm">No assets match "{searchQuery}"</p>
                {!isAiSearch && <p className="text-xs">in {TYPE_LABEL[type] || type} type</p>}
                {isAiSearch && <p className="text-xs">Try different keywords</p>}
              </>
            ) : (
              <>
                <Layers size={36} strokeWidth={1} />
                <p className="text-sm">No assets in this category</p>
              </>
            )}
          </div>
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}, 1fr))` }}
          >
            {displayAssets.map(asset => {
              // AI Search returns mixed asset types — each card uses its own
              // rag_asset_type/rag_style_type_id, falling back to the
              // category-scoped type when not in AI search mode.
              const cardType        = isAiSearch ? (asset.rag_asset_type || type) : type
              const cardStyleTypeId = isAiSearch ? (asset.rag_style_type_id ?? styleTypeId) : styleTypeId

              return (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  type={cardType}
                  styleTypeId={cardStyleTypeId}
                  isBatchMode={isBatchMode}
                  isSelected={selectedIds.has(asset.id)}
                  onToggleSelect={toggleSelect}
                  processingStatus={statusMap.get(asset.id)}
                  ragScore={isAiSearch ? asset.rag_score : null}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}