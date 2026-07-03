import { useRef, useEffect, useState, useCallback } from 'react'
import { FileX, Pencil, Link, Check, ArrowRightFromLine, Loader } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import AssetEditModal from './AssetEditModal'
import BlenderAppendModal from './BlenderAppendModal'

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
  const { openAsset, reloadCurrentCategory } = useAssetStore()
  const [asset, setAsset]                 = useState(initialAsset)
  const [isHovered, setIsHovered]         = useState(false)
  const [previewError, setPreviewError]   = useState(false)
  const [editOpen, setEditOpen]           = useState(false)
  const [appendOpen, setAppendOpen]       = useState(false)
  const [copied, setCopied]               = useState(false)
  const videoRef = useRef(null)

  useEffect(() => { setAsset(initialAsset); setPreviewError(false) }, [initialAsset])

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

  return (
    <>
      <div
        onClick={() => !isBatchMode && openAsset(asset.raw_path)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`
          group relative flex flex-col rounded-md overflow-hidden cursor-pointer
          bg-c-raised border transition-all duration-200
          ${isSelected && isBatchMode
            ? 'border-c-accent bg-c-accent/5 shadow-lg shadow-c-accent/10'
            : isHovered && !isBatchMode
            ? 'border-c-accent/60 shadow-lg shadow-c-accent/10 scale-[1.02]'
            : 'border-c-border/40 hover:border-c-border'
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
              bg-black/60 text-white/90 border border-white/10">
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
                  : 'bg-white/10 backdrop-blur-md border-2 border-white/30 hover:border-white/60 hover:bg-white/20 hover:scale-110'
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
          {!isBatchMode && (
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
          {!isBatchMode && showAppend && (
            <div className={`
              absolute top-1.5 right-1.5 z-10 flex gap-1
              transition-all duration-150
              ${isHovered ? 'opacity-100' : 'opacity-0'}
            `}>

              {/* Append to Blender — hanya untuk .blend */}
              <button
                onClick={(e) => { e.stopPropagation(); setAppendOpen(true) }}
                className="p-1.5 rounded-md bg-black/60 backdrop-blur-sm
                  text-white/70 hover:text-white hover:bg-black/80
                  transition-all duration-150"
                title="Append to Blender"
              >
                <ArrowRightFromLine size={11} />
              </button>

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
    </>
  )
}