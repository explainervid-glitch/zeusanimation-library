import { useState, useRef, useEffect } from 'react'
import {
  ChevronDown, ChevronRight, ChevronLeft, Image,
  Pencil, Check, X, PersonStanding, Users, PanelLeftClose, PanelLeftOpen, Lightbulb, Sparkles,
} from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import useBatchStore from '../../store/useBatchStore'
import { usePanelStore, usePanelStoreApi } from '../../store/PanelStoreContext'
import { usePanelSidebarStore } from '../../store/SidebarStoreContext'
import useSessionStore from '../../store/useSessionStore'
import EditCategoryModal from './EditCategoryModal'

const TYPE_ICON = {
  background: <Image          size={13} />,
  character:  <Users          size={13} />,
  animation:  <PersonStanding size={13} />,
  inspiration: <Lightbulb       size={13} />,
}
const TYPE_LABEL = {
  background: 'Background',
  character:  'Character',
  animation:  'Movement',
  inspiration: 'Inspiration',
}

// ─── CATEGORY ITEM ────────────────────────────────────────────
function CategoryItem({ category, styleId, type, styleTypeId, isUncategorized }) {
  const selectedCategory = usePanelStore((s) => s.selectedCategory)
  const selectCategory   = usePanelStore((s) => s.selectCategory)
  const isSelected = selectedCategory?.id === category.id
  const assetCount = category.asset_count ?? 0
  const isEmpty    = assetCount === 0

  return (
    <button
      onClick={() => selectCategory({ ...category, type, styleId, style_type_id: styleTypeId })}
      className={`
        w-full text-left pl-8 pr-2 py-1 rounded-md
        flex items-center justify-between gap-2
        transition-all duration-150 group/cat
        ${isSelected
          ? isUncategorized
            ? 'bg-amber-500/20 text-amber-400'
            : 'bg-c-accent text-c-on-accent'
          : isUncategorized
            ? 'text-amber-500/60 hover:bg-amber-500/10 hover:text-amber-400'
            : isEmpty
              ? 'text-c-text-4 hover:text-c-text-3 hover:bg-c-raised/40'
              : 'text-c-text-2 hover:text-c-text hover:bg-c-hover'
        }
      `}
    >
      <span className={`text-[11px] truncate font-normal ${isSelected ? 'font-medium' : ''}`}>
        {category.name}
      </span>
    </button>
  )
}

// ─── TYPE SECTION ─────────────────────────────────────────────
function TypeSection({ typeData, styleId }) {
  const toggleOpenType = useSessionStore(s => s.toggleOpenType)
  const startTypeBatch = useBatchStore(s => s.startTypeBatch)
  // Init from the persisted session so expanded sections restore on launch.
  const [open, setOpen] = useState(() => useSessionStore.getState().openTypeIds.includes(typeData.id))
  const [editCatOpen, setEditCatOpen] = useState(false)
  const [menuPos, setMenuPos]         = useState(null)   // { x, y } | null
  const [loadingBatch, setLoadingBatch] = useState(false)

  // Total taggable assets across all real categories of this type.
  const typeAssetCount = typeData.categories
    .filter(c => c.name !== '⚠ Uncategorized')
    .reduce((sum, c) => sum + (c.asset_count || 0), 0)

  const handleToggle = () => {
    setOpen(o => {
      const next = !o
      toggleOpenType(typeData.id, next)
      return next
    })
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  const handleBatchTagType = async () => {
    setMenuPos(null)
    if (typeAssetCount === 0 || loadingBatch) return
    setLoadingBatch(true)
    try {
      const res = await window.api.getAssetsByStyleType(typeData.id)
      if (res?.success && res.data?.length) {
        startTypeBatch(res.data, typeData.type)
      }
    } finally {
      setLoadingBatch(false)
    }
  }

  return (
    <div className="mb-1">
      <div className="flex items-center group/type" onContextMenu={handleContextMenu}>
        {/* Expand toggle + label */}
        <button
          onClick={handleToggle}
          className="flex-1 flex items-center gap-1.5 pl-2 pr-1 py-1.5
            text-[11px] font-semibold text-c-text uppercase tracking-wider
            hover:text-c-text transition-colors min-w-0"
        >
          <span className="text-c-text flex-shrink-0">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
          <span className="text-c-text flex-shrink-0">{TYPE_ICON[typeData.type]}</span>
          <span className="flex-1 text-left truncate">{TYPE_LABEL[typeData.type] || typeData.type}</span>
        </button>

        {/* Edit categories button — muncul saat hover */}
        <button
          onClick={(e) => { e.stopPropagation(); setEditCatOpen(true) }}
          className="flex-shrink-0 p-1 mr-1 rounded
            opacity-0 group-hover/type:opacity-100
            text-c-text-4 hover:text-c-accent hover:bg-c-raised
            transition-all duration-150"
          title="Edit categories"
        >
          <Pencil size={13} />
        </button>
      </div>

      {open && (
        <div className="ml-1 space-y-0.5 mb-1">
          {typeData.categories
            .filter(cat => cat.name !== '⚠ Uncategorized')
            .map(cat => (
              <CategoryItem key={cat.id} category={cat} styleId={styleId} type={typeData.type} styleTypeId={typeData.id} />
            ))
          }

          {/* Uncategorized — paling bawah, hanya tampil jika ada */}
          {typeData.categories.filter(cat => cat.name === '⚠ Uncategorized').map(cat => (
            <div key={cat.id} className="mt-1 pt-1 border-t border-c-border">
              <CategoryItem
                category={cat}
                styleId={styleId}
                type={typeData.type}
                styleTypeId={typeData.id}
                isUncategorized
              />
            </div>
          ))}
        </div>
      )}

      {/* Edit Category Modal */}
      {editCatOpen && (
        <EditCategoryModal
          typeData={typeData}
          styleId={styleId}
          onClose={() => setEditCatOpen(false)}
        />
      )}

      {/* Right-click context menu — batch tag the whole type */}
      {menuPos && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuPos(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenuPos(null) }}
          />
          <div
            className="fixed z-50 min-w-[200px] bg-c-surface border border-c-border rounded-lg shadow-2xl py-1"
            style={{ top: menuPos.y, left: menuPos.x }}
          >
            <button
              onClick={handleBatchTagType}
              disabled={typeAssetCount === 0 || loadingBatch}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
                ${typeAssetCount === 0
                  ? 'text-c-text-4 cursor-not-allowed'
                  : 'text-c-text-2 hover:bg-c-hover hover:text-c-text'
                }`}
            >
              <Sparkles size={13} className="text-c-accent flex-shrink-0" />
              {loadingBatch
                ? 'Loading…'
                : `Batch Tag all ${TYPE_LABEL[typeData.type] || typeData.type} (${typeAssetCount})`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── STYLE PILL ───────────────────────────────────────────────
const PILL_WIDTH = 150

function StylePill({ style, isSelected, onClick, onRename }) {
  const [editing, setEditing]  = useState(false)
  const [nameVal, setNameVal]  = useState(style.name)
  const [descVal, setDescVal]  = useState(style.description || '')
  const nameRef                = useRef(null)

  // Sync jika prop berubah dari luar (setelah save berhasil)
  useEffect(() => {
    if (!editing) {
      setNameVal(style.name)
      setDescVal(style.description || '')
    }
  }, [style.name, style.description, editing])

  useEffect(() => {
    if (editing && nameRef.current) {
      nameRef.current.focus()
      nameRef.current.select()
    }
  }, [editing])

  const startEdit = (e) => {
    e.stopPropagation()
    setNameVal(style.name)
    setDescVal(style.description || '')
    setEditing(true)
  }

  const confirmEdit = async (e) => {
    e?.stopPropagation()
    const nameTrimmed = nameVal.trim()
    const descTrimmed = descVal.trim()
    if (nameTrimmed) {
      // Selalu kirim bahkan jika tidak berubah agar deskripsi tersimpan
      await onRename(style.id, nameTrimmed, descTrimmed)
    }
    setEditing(false)
  }

  const cancelEdit = (e) => {
    e?.stopPropagation()
    setNameVal(style.name)
    setDescVal(style.description || '')
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) confirmEdit()
    if (e.key === 'Escape') cancelEdit()
  }

  if (editing) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-c-accent bg-c-raised snap-start flex-shrink-0"
        style={{ width: PILL_WIDTH }}
        onClick={e => e.stopPropagation()}
      >
        {/* Name input */}
        <input
          ref={nameRef}
          value={nameVal}
          onChange={e => setNameVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nama style"
          className="w-full bg-transparent text-c-text text-xs font-semibold
            text-center outline-none border-b border-c-accent/60 pb-0.5"
        />

        {/* Description input */}
        <input
          value={descVal}
          onChange={e => setDescVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Description"
          className="w-full bg-transparent text-c-text-3 text-[9px]
            text-center outline-none border-b border-c-border-2 pb-0.5"
        />

        {/* Buttons */}
        <div className="flex gap-3 pt-0.5">
          <button
            onClick={confirmEdit}
            className="flex items-center gap-1 text-[10px] text-c-accent hover:text-c-accent-h"
          >
            <Check size={11} /> Save
          </button>
          <button
            onClick={cancelEdit}
            className="flex items-center gap-1 text-[10px] text-c-text-4 hover:text-c-text-2"
          >
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{ width: PILL_WIDTH }}
      className={`
        group/pill relative snap-start flex-shrink-0 cursor-pointer
        flex flex-col items-center justify-center gap-0.5
        px-2 py-2.5 rounded-lg border
        transition-all duration-150
        ${isSelected
          ? 'bg-c-accent text-c-on-accent border-c-accent'
          : 'bg-c-raised text-c-text-2 border-c-border hover:border-c-border-2 hover:text-c-text hover:bg-c-hover'
        }
      `}
    >
      {/* Nama style */}
      <span className="text-[12px] font-bold leading-tight text-center w-full truncate">
        {style.name}
      </span>

      {/* Deskripsi */}
      <span className={`text-[10px] leading-tight text-center w-full truncate
        ${isSelected ? 'text-c-on-accent/70' : 'text-c-text-2'}`}
      >
        {style.description || '—'}
      </span>

      {/* Edit button */}
      <button
        onClick={startEdit}
        className={`
          absolute top-1 right-1 p-0.5
          opacity-0 group-hover/pill:opacity-100 transition-opacity
          ${isSelected ? 'text-c-on-accent/60 hover:text-c-on-accent' : 'text-c-text-4 hover:text-c-text-2'}
        `}
        title="Edit nama dan deskripsi"
      >
        <Pencil size={9} />
      </button>
    </div>
  )
}

// ─── STYLE SCROLL BAR ─────────────────────────────────────────
function StyleScrollBar({ tree, selectedStyleId, onSelectStyle }) {
  const { renameStyle } = useAssetStore()
  const scrollRef       = useRef(null)
  const [canLeft, setCanLeft]   = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateArrows = () => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateArrows()
    el.addEventListener('scroll', updateArrows)
    window.addEventListener('resize', updateArrows)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      window.removeEventListener('resize', updateArrows)
    }
  }, [tree])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollBy({ left: e.deltaY * 1.5, behavior: 'smooth' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!scrollRef.current || selectedStyleId === null) return
    const idx = tree.findIndex(s => s.id === selectedStyleId)
    if (idx < 0) return
    const pills = scrollRef.current.querySelectorAll('[data-pill]')
    pills[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedStyleId])

  const scroll = (dir) => {
    scrollRef.current?.scrollBy({ left: dir * (PILL_WIDTH + 6), behavior: 'smooth' })
  }

  return (
    <div className="border-b border-c-border flex-shrink-0">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          onClick={() => scroll(-1)}
          disabled={!canLeft}
          className={`flex-shrink-0 p-0.5 rounded transition-all
            ${canLeft
              ? 'text-c-text-3 hover:text-c-text hover:bg-c-raised'
              : 'text-c-text-4 opacity-30 cursor-default'
            }`}
        >
          <ChevronLeft size={13} />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto flex-1
            scroll-smooth snap-x snap-mandatory
            [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tree.map(style => (
            <div key={style.id} data-pill>
              <StylePill
                style={style}
                isSelected={style.id === selectedStyleId}
                onClick={() => onSelectStyle(style.id)}
                onRename={renameStyle}
              />
            </div>
          ))}
        </div>

        <button
          onClick={() => scroll(1)}
          disabled={!canRight}
          className={`flex-shrink-0 p-0.5 rounded transition-all
            ${canRight
              ? 'text-c-text-3 hover:text-c-text hover:bg-c-raised'
              : 'text-c-text-4 opacity-30 cursor-default'
            }`}
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {tree.length > 1 && (
        <div className="flex justify-center gap-1 py-1.5">
          {tree.map(style => (
            <button
              key={style.id}
              onClick={() => onSelectStyle(style.id)}
              className={`rounded-full transition-all duration-200
                ${style.id === selectedStyleId
                  ? 'bg-c-accent w-3 h-1.5'
                  : 'bg-c-border-2 w-1.5 h-1.5 hover:bg-c-text-4'
                }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────
export default function Sidebar() {
  // Workspace-level state (tree/pack/scan) is shared → read from the main store.
  const { tree, treeLoading, scanning } = useAssetStore()
  // Panel-level state (style/category/search) → read from this panel's store.
  const selectedStyleId = usePanelStore((s) => s.selectedStyleId)
  const selectStyle     = usePanelStore((s) => s.selectStyle)
  const clearSearch     = usePanelStore((s) => s.clearSearch)
  const panelApi        = usePanelStoreApi()
  const { isOpen, width, toggleSidebar, setSidebarWidth } = usePanelSidebarStore()

  useEffect(() => {
    if (tree.length > 0 && selectedStyleId === null) {
      selectStyle(tree[0].id)
    }
  }, [tree])

  // Reset grid saat ganti style
  const handleSelectStyle = (styleId) => {
    if (styleId === selectedStyleId) return
    selectStyle(styleId)
    panelApi.getState().selectCategory(null)
    clearSearch()
  }

  const selectedStyle = tree.find(s => s.id === selectedStyleId) || null

  const sidebarRef = useRef(null)
  const isResizing = useRef(false)
  // true while dragging the resize handle → temporarily disables the width
  // transition so the sidebar tracks the cursor instantly instead of lagging.
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current || !sidebarRef.current) return
      const rect     = sidebarRef.current.parentElement.getBoundingClientRect()
      const newWidth = e.clientX - rect.left
      if (newWidth > 150 && newWidth < 500) setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (isResizing.current) { isResizing.current = false; setDragging(false) }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setSidebarWidth])

  const startResize = (e) => {
    if (e.button !== 0) return
    isResizing.current = true
    setDragging(true)
    e.preventDefault()
  }

  // Single container whose WIDTH animates between collapsed (56px) and the
  // user's width, so hiding/showing the sidebar slides instead of snapping.
  const COLLAPSED_W = 56

  return (
    <div
      ref={sidebarRef}
      className={`h-full bg-c-surface border-r border-c-border flex flex-col overflow-hidden flex-shrink-0 relative
        ${dragging ? '' : 'transition-[width] duration-300 ease-in-out'}`}
      style={{ width: `${isOpen ? width : COLLAPSED_W}px` }}
    >
      {!isOpen ? (
        /* Collapsed — just the reopen button */
        <div className="flex flex-col items-center pt-3">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg bg-c-raised hover:bg-c-hover text-c-text-3 hover:text-c-text transition-all"
            title="Show sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>
      ) : (
        /* Expanded — fixed inner width so content doesn't reflow mid-animation */
        <div className="h-full flex flex-col" style={{ width: `${width}px` }}>
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-c-border flex items-center justify-between flex-shrink-0">
            <p className="text-[10px] text-c-text-4 uppercase tracking-widest font-medium">
              Assets Library
            </p>
            <button
              onClick={toggleSidebar}
              className="p-1 rounded hover:bg-c-hover text-c-text-3 hover:text-c-text transition-all"
              title="Hide sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          {/* Style horizontal scroll */}
          {!treeLoading && !scanning && tree.length > 0 && (
            <StyleScrollBar
              tree={tree}
              selectedStyleId={selectedStyleId}
              onSelectStyle={handleSelectStyle}
            />
          )}

          {/* Loading */}
          {(treeLoading || scanning) && (
            <div className="flex items-center gap-2 px-3 py-4 text-c-text-3 text-xs">
              <div className="w-3 h-3 border border-c-border-2 border-t-c-accent rounded-full animate-spin" />
              {scanning ? 'Scanning folder...' : 'Memuat aset...'}
            </div>
          )}

          {/* Empty */}
          {!treeLoading && !scanning && tree.length === 0 && (
            <div className="px-3 py-4 text-c-text-4 text-xs text-center">
              <p>No assets found.</p>
              <p className="mt-1">Click Rescan in the toolbar.</p>
            </div>
          )}

          {/* Category tree — mr-1 clears the resize handle so the scrollbar doesn't collide */}
          <div className="flex-1 overflow-y-auto px-2 py-2 mr-1">
            {selectedStyle && selectedStyle.types.map(typeData => (
              <TypeSection key={typeData.id} typeData={typeData} styleId={selectedStyle.id} />
            ))}
          </div>
        </div>
      )}

      {/* Resize handle — only when expanded */}
      {isOpen && (
        <div
          onMouseDown={startResize}
          className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-c-accent/50 transition-colors z-10"
        />
      )}
    </div>
  )
}