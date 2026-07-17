import { useRef, useEffect, useState, useCallback } from 'react'
import { FileX, Pencil, Link, Check, ArrowRightFromLine, Loader, Import } from 'lucide-react'
import { usePanelStore } from '../../store/PanelStoreContext'
import useProjectStore from '../../store/useProjectStore'
import useAssetStore from '../../store/useAssetStore'
import useSettingsStore from '../../store/useSettingsStore'
import useCompileStore from '../../store/useCompileStore'
import AssetEditModal from './AssetEditModal'
import BlenderAppendModal from './BlenderAppendModal'
import BlenderImportModal from './BlenderImportModal'

const TYPE_RATIO = {
  background: [285, 161],
  character:  [340, 500],
  animation:  [170, 250],
}
const DEFAULT_RATIO = [16, 9]

const VIDEO_EXTS = ['.mp4', '.webm']
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
// SWF reserved for Ruffle integration — detected but not rendered yet
const SWF_EXTS   = ['.swf']

function getExt(path) {
  if (!path) return ''
  return path.slice(path.lastIndexOf('.')).toLowerCase()
}

// Returns 'video' | 'swf' | 'image' | null
// Detection order: mp4/webm → swf (future) → image
function getPreviewType(path) {
  if (!path) return null
  const ext = getExt(path)
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (SWF_EXTS.includes(ext))   return 'swf'    // placeholder — rendered as no-preview for now
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return null
}

// Pick the best available preview path from an asset row.
// Priority: mp4_path (video or image) → thumbnail_path → raw_path
// Within each candidate, prefer the one that matches a higher-priority type.
function resolvePreviewPath(asset) {
  const candidates = [
    asset.mp4_path,
    asset.thumbnail_path,
    asset.raw_path,
  ].filter(Boolean)

  // First pass: find a video file
  const video = candidates.find(p => VIDEO_EXTS.includes(getExt(p)))
  if (video) return video

  // Second pass: (SWF — future, skip rendering for now but still detect)
  // const swf = candidates.find(p => SWF_EXTS.includes(getExt(p)))
  // if (swf) return swf

  // Third pass: find an image file
  const image = candidates.find(p => IMAGE_EXTS.includes(getExt(p)))
  if (image) return image

  // Fallback: first available path regardless of type (shows no-preview placeholder)
  return candidates[0] ?? null
}

function toFileUrl(winPath) {
  if (!winPath) return null
  return 'file:///' + winPath.replace(/\\/g, '/')
}

// Hanya tampilkan tombol Append untuk .blend
function isBlendFile(path) {
  return path?.toLowerCase().endsWith('.blend') ?? false
}

export default function AssetCard({ asset: initialAsset, type, styleTypeId, isBatchMode, isSelected, onToggleSelect, processingStatus, ragScore = null }) {
  const openAsset             = usePanelStore((s) => s.openAsset)
  const reloadCurrentCategory = usePanelStore((s) => s.reloadCurrentCategory)
  const activeProject         = useProjectStore((s) => s.activeProject)
  const importCharactersEnabled = useSettingsStore((s) => s.importCharactersEnabled)
  const blenderImportEnabled  = useSettingsStore((s) => s.blenderImportEnabled)
  const blenderImportMode     = useSettingsStore((s) => s.blenderImportMode)
  const isCompileMode         = useCompileStore((s) => s.isCompileMode)
  const compileCharacterId    = useCompileStore((s) => s.character?.id)
  const compileMovementId     = useCompileStore((s) => s.movement?.id)
  const pickForCompile        = useCompileStore((s) => s.pickAsset)
  const [asset, setAsset]                 = useState(initialAsset)
  const [isHovered, setIsHovered]         = useState(false)
  const [previewError, setPreviewError]   = useState(false)
  const [editOpen, setEditOpen]           = useState(false)
  const [appendOpen, setAppendOpen]       = useState(false)
  const [linkOpen, setLinkOpen]           = useState(false)
  const [copied, setCopied]               = useState(false)
  const [sending, setSending]             = useState(false)
  const [renaming, setRenaming]           = useState(false)
  const [renameValue, setRenameValue]     = useState('')
  const [renameAnchor, setRenameAnchor]   = useState(null)   // button DOMRect
  const videoRef   = useRef(null)
  const renameRef  = useRef(null)
  const popoverRef = useRef(null)

  useEffect(() => { setAsset(initialAsset); setPreviewError(false); setRenaming(false) }, [initialAsset])

  // Focus the rename input and pre-select the name stem (keeps the extension).
  useEffect(() => {
    if (renaming && renameRef.current) {
      const el  = renameRef.current
      el.focus()
      const dot = el.value.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
    }
  }, [renaming])

  // Close the rename popover on an outside click (dropdown behavior).
  useEffect(() => {
    if (!renaming) return
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setRenaming(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [renaming])

  const [rw, rh]   = TYPE_RATIO[type] || DEFAULT_RATIO
  const paddingTop  = `${(rh / rw) * 100}%`

  const previewPath = resolvePreviewPath(asset)
  const previewType = previewError ? null : getPreviewType(previewPath)
  const previewUrl  = toFileUrl(previewPath)

  useEffect(() => {
    if (previewType === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {})
    }
  }, [previewType])

  const handleCopyPath = useCallback((e) => {
    e.stopPropagation()
    if (!asset.raw_path) return
    navigator.clipboard.writeText(asset.raw_path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [asset.raw_path])

  const handleSaved = useCallback(async (updated) => {
    setEditOpen(false)
    // Reload assets dari DB → initialAsset prop terupdate → card render fresh
    await reloadCurrentCategory()
  }, [reloadCurrentCategory])

  const showAppend = isBlendFile(asset.raw_path) && type === 'animation'

  // Single "Import" button for Character cards. The two flows underneath stay
  // completely separate — this just decides which one runs, based on the
  // Settings toggles AND whether the file can be imported into Blender (.blend).
  const showImport   = type === 'character' && importCharactersEnabled
  const canImport    = blenderImportEnabled && isBlendFile(asset.raw_path)
  // When Import Characters is on, character cards are import-only (no open-on-click).
  const importOnly   = type === 'character' && importCharactersEnabled

  // Compile mode: character + animation cards are pickable into the tray slots.
  const isCompilePickable = isCompileMode && (type === 'character' || type === 'animation')
  const isCompileSelected = isCompileMode && (
    (type === 'character' && compileCharacterId === asset.id) ||
    (type === 'animation' && compileMovementId  === asset.id)
  )

  // Copy this character into {project}/Chars (optionally under a custom name),
  // then open it from there. Returns true on success.
  const runSendToProject = useCallback(async (targetName) => {
    if (!activeProject?.path) {
      useAssetStore.getState().setError('No active project — create or select one in the bottom bar first.')
      return false
    }
    if (!asset.raw_path) {
      useAssetStore.getState().setError('This asset has no source file to send.')
      return false
    }
    setSending(true)
    try {
      const result = await window.api.sendToProject({
        sourcePath:  asset.raw_path,
        projectPath: activeProject.path,
        targetName,
      })
      if (result.success) {
        await openAsset(result.data)   // open from {project}/Chars, not the library path
        return true
      }
      useAssetStore.getState().setError(result.error || 'Failed to send asset to project.')
      return false
    } catch (err) {
      useAssetStore.getState().setError(err.message)
      return false
    } finally {
      setSending(false)
    }
  }, [activeProject, asset.raw_path, openAsset])

  // ── Inline rename (Send-to-Project-only mode) ──────────────────
  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : '')
  const startRename = (rect) => {
    if (!activeProject?.path) {
      useAssetStore.getState().setError('No active project — create or select one in the bottom bar first.')
      return
    }
    setRenameValue(baseName(asset.raw_path))
    setRenameAnchor(rect || null)
    setRenaming(true)
  }
  const confirmRename = async () => {
    const name = renameValue.trim()
    if (!name || sending) return
    const ok = await runSendToProject(name)
    if (ok) setRenaming(false)
  }
  const handleRenameKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); confirmRename() }
    if (e.key === 'Escape') { e.preventDefault(); setRenaming(false) }
  }

  // Import button router. When importing into Blender is off (Send-to-Project
  // only), reveal an inline rename input instead of copying immediately.
  const handleImportClick = useCallback((e) => {
    e.stopPropagation()
    if (canImport) setLinkOpen(true)                             // BlenderImportModal
    else           startRename(e.currentTarget.getBoundingClientRect())  // floating rename
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, activeProject, asset.raw_path])

  return (
    <>
      <div
        onClick={() => {
          if (isCompileMode) { if (isCompilePickable) pickForCompile(asset, type); return }
          if (isBatchMode || importOnly) return   // import-only: open only via the Import button
          openAsset(asset.raw_path)
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`
          group relative flex flex-col rounded-md overflow-hidden cursor-pointer
          bg-c-raised border transition-all duration-200
          ${(isSelected && isBatchMode) || isCompileSelected
            ? 'border-c-accent bg-c-accent/5 shadow-lg shadow-c-accent/10'
            : isHovered && !isBatchMode
            ? 'border-c-accent/60 shadow-lg shadow-c-accent/10 scale-[1.02]'
            : 'border-c-border hover:border-c-border-2'
          }
        `}
      >
        {/* Preview Area */}
        <div className="relative w-full bg-c-base overflow-hidden" style={{ paddingTop }}>
          <div className="absolute inset-0">

            {previewType === 'image' && (
              <img src={previewUrl} alt={asset.name}
                onError={() => setPreviewError(true)}
                className="w-full h-full object-cover" />
            )}

            {previewType === 'video' && (
              <video ref={videoRef} src={previewUrl}
                loop muted playsInline preload="auto"
                onError={() => setPreviewError(true)}
                className="w-full h-full object-cover" />
            )}

            {!previewType && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-c-text-4">
                <FileX size={28} strokeWidth={1.5} />
                <span className="text-[10px]">No Preview</span>
              </div>
            )}
          </div>

          {/* AI Search relevance score — bottom-left corner */}
          {ragScore != null && (
            <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-md
              text-[10px] font-mono font-medium backdrop-blur-sm
              bg-black/60 text-white/90 border border-white/5">
              {Math.round(ragScore * 100)}%
            </span>
          )}

          {/* Batch Mode: Modern checkbox - top right */}
          {isBatchMode && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (onToggleSelect) onToggleSelect(asset.id)
              }}
              className={`
                absolute top-2 right-2 z-20 w-6 h-6 rounded-lg
                flex items-center justify-center cursor-pointer
                transition-all duration-200 ease-out
                ${isSelected
                  ? 'bg-c-accent border-2 border-c-accent shadow-lg shadow-c-accent/30 scale-100'
                  : 'bg-white/5 backdrop-blur-md border-2 border-white/10 hover:border-white/25 hover:bg-white/10 hover:scale-110'
                }
              `}
              title={isSelected ? 'Deselect' : 'Select'}
            >
              {isSelected && (
                <Check size={14} className="text-c-on-accent stroke-[3]" />
              )}
            </button>
          )}

          {/* Processing spinner overlay */}
          {processingStatus?.status === 'processing' && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <Loader size={24} className="text-c-accent animate-spin" strokeWidth={2} />
            </div>
          )}

          {/* Action buttons - Left side */}
          {!isBatchMode && !isCompileMode && !renaming && (
            <div className={`
              absolute top-1.5 left-1.5 z-10 flex gap-1
              transition-all duration-150
              ${isHovered ? 'opacity-100' : 'opacity-0'}
            `}>

              {/* Edit */}
              <button
                onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
                className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm
                  text-white/70 hover:text-white hover:bg-black/80
                  transition-all duration-150"
                title="Edit asset info"
              >
                <Pencil size={11} />
              </button>

              {/* Copy path */}
              <button
                onClick={handleCopyPath}
                disabled={!asset.raw_path}
                className={`p-1.5 rounded-md backdrop-blur-sm transition-all duration-150
                  ${copied
                    ? 'bg-green-500/80 text-white'
                    : 'bg-black/60 text-white/70 hover:text-white hover:bg-black/80'
                  }
                  ${!asset.raw_path ? 'opacity-30 cursor-not-allowed' : ''}`}
                title={asset.raw_path ? `Copy: ${asset.raw_path}` : 'No raw file'}
              >
                {copied ? <Check size={11} /> : <Link size={11} />}
              </button>

            </div>
          )}

          {/* Action buttons - Right side */}
          {!isBatchMode && !isCompileMode && !renaming && (showAppend || showImport) && (
            <div className={`
              absolute top-1.5 right-1.5 z-10 flex gap-1
              transition-all duration-150
              ${isHovered ? 'opacity-100' : 'opacity-0'}
            `}>

              {/* Append to Blender — hanya untuk .blend */}
              {showAppend && (
                <button
                  onClick={(e) => { e.stopPropagation(); setAppendOpen(true) }}
                  className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm
                    text-white/70 hover:text-white hover:bg-black/80
                    transition-all duration-150"
                  title="Append to Blender"
                >
                  <ArrowRightFromLine size={11} />
                </button>
              )}

              {/* Import — routes to Send-to-Project or Append/Link-to-Blender per
                  the Settings toggles (Character Import). Same button either way. */}
              {showImport && (
                <button
                  onClick={handleImportClick}
                  disabled={!activeProject || sending}
                  className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm
                    text-white/70 hover:text-white hover:bg-black/80
                    transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    !activeProject ? 'Select a project first (bottom bar)'
                    : sending       ? 'Sending…'
                    : canImport     ? `Import & ${blenderImportMode === 'link' ? 'Link' : 'Append'} to Blender (${activeProject.name}\\Chars)`
                    : `Import to ${activeProject.name}\\Chars`
                  }
                >
                  {sending
                    ? <Loader size={11} className="animate-spin" />
                    : <Import size={11} />}
                </button>
              )}

            </div>
          )}
        </div>

        {/* Label */}
        <div className="px-2.5 py-2">
          <p className="text-xs font-medium text-c-text truncate leading-tight">
            {asset.name}
          </p>
          {asset.detail && (
            <p className="text-[10px] text-c-text-3 truncate mt-0.5" title={asset.detail}>
              {asset.detail}
            </p>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editOpen && (
        <AssetEditModal
          asset={asset} type={type} styleTypeId={styleTypeId}
          onClose={() => setEditOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Blender Append Modal */}
      {appendOpen && (
        <BlenderAppendModal
          asset={asset}
          onClose={() => setAppendOpen(false)}
        />
      )}

      {/* Blender Import Modal — copies into project, then appends/links from there */}
      {linkOpen && (
        <BlenderImportModal
          asset={asset}
          projectPath={activeProject?.path}
          mode={blenderImportMode}
          onClose={() => setLinkOpen(false)}
        />
      )}

      {/* Floating rename popover (Send-to-Project-only) — anchored under the
          Import button, rendered here so the card's overflow can't clip it. */}
      {renaming && renameAnchor && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top:   renameAnchor.bottom + 6,
            right: Math.max(8, window.innerWidth - renameAnchor.right),
            zIndex: 60,
          }}
          className="w-60 bg-c-surface border border-c-border rounded-xl shadow-2xl p-2.5
            animate-[compileSlideIn_140ms_ease-out]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] uppercase tracking-wider text-c-text-2 px-0.5 pb-1.5">
            Rename
          </p>
          <div className="flex items-center gap-1.5">
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKey}
              disabled={sending}
              placeholder="File name"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs
                bg-c-raised text-c-text placeholder-c-text-4
                border border-c-border-2 focus:border-c-accent outline-none transition-colors"
            />
            <button
              onClick={confirmRename}
              disabled={sending || !renameValue.trim()}
              title="Copy into project"
              className="flex-shrink-0 p-1.5 rounded-lg bg-c-accent text-c-on-accent
                hover:bg-c-accent-h transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}