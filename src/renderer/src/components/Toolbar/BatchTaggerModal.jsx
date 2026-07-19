import { useState, useEffect, useCallback } from 'react'
import { X, Astroid, AlertCircle, CheckCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import useBatchStore from '../../store/useBatchStore'

// Non-blocking corner panel (like the Compile tray): batch tagging runs in the
// background here, so the user can keep working in the app while it processes.
export default function BatchTaggerModal() {
  const { assets, selectedCategory } = useAssetStore()
  const {
    isModalOpen, batchAssets, batchAssetType, batchTargets,
    selectedIds, statusMap, isRunning, doneCount, totalCount,
    runBatch, saveAllResults, resetBatch,
  } = useBatchStore()

  const [taggingComplete, setTaggingComplete] = useState(false)
  const [saveInProgress, setSaveInProgress] = useState(false)
  const [saveResult, setSaveResult] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (isModalOpen) { setTaggingComplete(false); setSaveResult(null) }
  }, [isModalOpen])

  // Dismiss = discard: stops any in-flight run and closes the tray. Use the
  // collapse chevron instead to minimise without losing progress.
  const handleClose = useCallback(() => {
    setTaggingComplete(false)
    setSaveResult(null)
    resetBatch()
  }, [resetBatch])

  const handleCancel = handleClose

  // Detect tagging completion
  useEffect(() => {
    if (isRunning === false && totalCount > 0 && doneCount === totalCount && !taggingComplete) {
      setTaggingComplete(true)
    }
  }, [isRunning, totalCount, doneCount, taggingComplete])

  // Pool for pre-run selection review: type-batch assets, else active category.
  const pool = (batchAssets && batchAssets.length) ? batchAssets : assets
  const selectedAssets = pool.filter(a => selectedIds.has(a.id))
  // Once a run has started, render the captured targets so it survives
  // navigating to a different category mid-tagging.
  const listAssets = batchTargets.length ? batchTargets : selectedAssets

  const rawType   = selectedCategory?.type || 'background'
  const assetType = batchAssetType ?? (rawType === 'movement' ? 'animation' : rawType)

  const handleStartTagging = useCallback(async () => {
    if (selectedIds.size === 0) return
    setTaggingComplete(false)
    setSaveResult(null)
    await runBatch(selectedAssets, assetType, () => {})
  }, [selectedIds.size, selectedAssets, assetType, runBatch])

  const handleSaveAll = useCallback(async () => {
    setSaveInProgress(true)
    try {
      const result = await saveAllResults()
      setSaveResult(result)
      setTimeout(() => resetBatch(), 2000)
    } catch (err) {
      setSaveResult({ successCount: 0, failureCount: selectedIds.size, errors: [{ error: err.message }] })
    } finally {
      setSaveInProgress(false)
    }
  }, [saveAllResults, selectedIds.size, resetBatch])

  if (!isModalOpen) return null

  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  return (
    <div className="fixed bottom-16 right-4 z-40 w-80 max-h-[72vh] flex flex-col
      bg-c-surface border border-c-border rounded-2xl shadow-2xl overflow-hidden
      animate-[compileSlideIn_220ms_ease-out]">

      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 flex-shrink-0
        ${!collapsed || isRunning || taggingComplete ? 'border-b border-c-border' : ''}`}>
        <div className="flex items-center gap-2">
          <Astroid size={15} className="text-c-accent" />
          <span className="text-xs font-bold text-c-text">Batch Tagger</span>
          {collapsed && isRunning && (
            <span className="text-[10px] text-c-accent tabular-nums">{doneCount}/{totalCount}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-c-text-3 hover:text-c-text transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            onClick={handleClose}
            className="text-c-text-3 hover:text-c-text transition-colors"
            title={isRunning ? 'Stop tagging and discard' : 'Close and discard'}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Progress bar — visible while running or after completion (even collapsed) */}
      {(isRunning || taggingComplete) && (
        <div className="px-4 pt-2.5 pb-0.5 flex-shrink-0">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className={isRunning ? 'text-c-accent font-medium' : 'text-green-500 font-medium'}>
              {isRunning ? 'Tagging…' : 'Tagging complete'}
            </span>
            <span className="tabular-nums text-c-text-3">{doneCount}/{totalCount}</span>
          </div>
          <div className="h-1.5 rounded-full bg-c-raised overflow-hidden">
            <div className="h-full bg-c-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Body — hidden when collapsed */}
      {!collapsed && (
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">

        {taggingComplete && !saveResult && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/30">
            <CheckCircle size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-green-500">Done — click <span className="font-semibold">Save All</span> to write the tags.</p>
          </div>
        )}

        {saveResult && (
          <div className={`flex items-start gap-2 p-2.5 rounded-lg border ${
            saveResult.failureCount === 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'
          }`}>
            {saveResult.failureCount === 0
              ? <CheckCircle size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
              : <AlertCircle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <p className={`text-[11px] font-medium ${saveResult.failureCount === 0 ? 'text-green-500' : 'text-yellow-500'}`}>
                Saved {saveResult.successCount}{saveResult.failureCount > 0 ? `, ${saveResult.failureCount} failed` : ''}
              </p>
              {saveResult.errors?.slice(0, 2).map((err, idx) => (
                <p key={idx} className="text-[10px] text-c-text-3 truncate">{err.assetName}: {err.error}</p>
              ))}
            </div>
          </div>
        )}

        {/* Selected count (pre-run) */}
        {!batchTargets.length && (
          <p className="text-[11px] font-medium text-c-text-2">
            {selectedIds.size} of {pool.length} selected
            {selectedIds.size === 0 && (
              <span className="block text-[10px] text-c-text-4 font-normal mt-0.5">Select assets via the checkboxes.</span>
            )}
          </p>
        )}

        {/* Asset list with per-asset status */}
        {listAssets.length > 0 && (
          <div className="border border-c-border rounded-lg divide-y divide-c-border/60 max-h-52 overflow-y-auto scrollbar-thin">
            {listAssets.map(asset => {
              const status      = statusMap.get(asset.id)
              const previewPath = asset.thumbnail_path || asset.mp4_path
              const isVideo     = !asset.thumbnail_path && !!asset.mp4_path
              const previewSrc  = previewPath
                ? `file:///${previewPath.replace(/\\/g, '/').replace(/^\w:/, m => m.toLowerCase())}`
                : null
              return (
                <div key={asset.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                  <div className="relative w-8 h-8 flex-shrink-0 rounded overflow-hidden bg-c-base border border-c-border">
                    {previewSrc ? (
                      isVideo
                        ? <video src={previewSrc} muted className="w-full h-full object-cover" />
                        : <img src={previewSrc} alt={asset.name} className="w-full h-full object-cover" onError={e => { e.target.style.display = 'none' }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[7px] text-c-text-4">—</div>
                    )}
                  </div>
                  <span className="flex-1 text-[11px] text-c-text truncate">{asset.name}</span>
                  <div className="flex-shrink-0">
                    {status?.status === 'processing' && <Loader size={13} className="text-c-accent animate-spin" />}
                    {status?.status === 'done'       && <CheckCircle size={13} className="text-green-500" />}
                    {status?.status === 'error'      && (
                      <AlertCircle size={13} className="text-red-500"
                        title={typeof status.error === 'string' ? status.error : JSON.stringify(status.error)} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* Footer — hidden when collapsed */}
      {!collapsed && (
      <div className="flex items-center gap-2 px-4 py-3 border-t border-c-border flex-shrink-0 bg-c-raised/40">
        <button
          onClick={handleCancel}
          title={isRunning ? 'Stop tagging and discard' : 'Discard this batch'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-c-base text-c-text border border-c-border hover:bg-c-hover transition-colors"
        >
          {isRunning ? 'Stop' : 'Cancel'}
        </button>

        {!taggingComplete ? (
          <button
            onClick={handleStartTagging}
            disabled={selectedIds.size === 0 || isRunning}
            className={`ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${selectedIds.size === 0 || isRunning
                ? 'bg-c-accent/50 text-c-on-accent/50 cursor-not-allowed'
                : 'bg-c-accent text-c-on-accent hover:bg-c-accent-h'}`}
          >
            {isRunning && <Loader size={13} className="animate-spin" />}
            {isRunning ? 'Processing…' : 'Start Tagging'}
          </button>
        ) : (
          <button
            onClick={handleSaveAll}
            disabled={saveInProgress}
            className={`ml-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${saveInProgress ? 'bg-c-accent/50 text-c-on-accent/50 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            {saveInProgress && <Loader size={13} className="animate-spin" />}
            {saveInProgress ? 'Saving…' : 'Save All'}
          </button>
        )}
      </div>
      )}
    </div>
  )
}
