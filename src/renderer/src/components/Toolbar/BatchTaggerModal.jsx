import { useState, useEffect, useCallback } from 'react'
import { X, Astroid, AlertCircle, CheckCircle, Loader } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'
import useBatchStore from '../../store/useBatchStore'

export default function BatchTaggerModal() {
  const { assets, selectedCategory } = useAssetStore()
  const {
    isModalOpen, closeModal, batchAssets, batchAssetType,
    selectedIds, statusMap, isRunning, doneCount, totalCount,
    runBatch, saveAllResults, exitBatchMode,
  } = useBatchStore()

  const [taggingComplete, setTaggingComplete] = useState(false)
  const [saveInProgress, setSaveInProgress] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  // Reset transient state when the modal opens
  useEffect(() => {
    if (isModalOpen) {
      setTaggingComplete(false)
      setSaveResult(null)
    }
  }, [isModalOpen])

  const handleClose = useCallback(() => {
    closeModal()
    // Don't exit batch mode - user can cancel tagging and go back to selection
  }, [closeModal])

  const handleCancel = useCallback(() => {
    setTaggingComplete(false)
    setSaveResult(null)
    exitBatchMode()   // also closes the modal (clears isModalOpen)
  }, [exitBatchMode])

  // Detect tagging completion
  useEffect(() => {
    if (isRunning === false && totalCount > 0 && doneCount === totalCount && !taggingComplete) {
      setTaggingComplete(true)
    }
  }, [isRunning, totalCount, doneCount, taggingComplete])

  // Pool: type-batch assets when present, else the active category's assets.
  const pool = (batchAssets && batchAssets.length) ? batchAssets : assets
  const selectedAssets = pool.filter(a => selectedIds.has(a.id))
  // Asset type: from the type-batch if set, else derived from the category.
  // (movement folders are tagged as 'animation')
  const rawType   = selectedCategory?.type || 'background'
  const assetType = batchAssetType ?? (rawType === 'movement' ? 'animation' : rawType)

  const handleStartTagging = useCallback(async () => {
    if (selectedIds.size === 0) return
    
    // Reset completion state sebelum mulai tagging baru
    setTaggingComplete(false)
    setSaveResult(null)
    
    await runBatch(selectedAssets, assetType, () => {
      // Optional: Update UI per asset if needed
    })
  }, [selectedIds.size, selectedAssets, assetType, runBatch])

  const handleSaveAll = useCallback(async () => {
    setSaveInProgress(true)
    try {
      const result = await saveAllResults(selectedAssets)
      setSaveResult(result)
      
      // Auto-close after showing result (exitBatchMode also closes the modal)
      setTimeout(() => {
        exitBatchMode()
      }, 2000)
    } catch (err) {
      setSaveResult({
        successCount: 0,
        failureCount: selectedIds.size,
        errors: [{ error: err.message }],
      })
    } finally {
      setSaveInProgress(false)
    }
  }, [selectedAssets, selectedIds.size, saveAllResults, exitBatchMode])

  if (!isModalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl bg-c-surface border border-c-border flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-c-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Astroid size={18} className="text-c-accent" />
            <h2 className="text-lg font-semibold text-c-text">Batch Tagger</h2>
          </div>
          <button
            onClick={handleClose}
            className="flex-shrink-0 p-1 text-c-text-3 hover:text-c-text hover:bg-c-hover rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          
          {/* Status Info */}
          {isRunning && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-c-accent/10 border border-c-accent mb-4">
              <Loader size={30} className="text-c-accent-h animate-spin flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-c-text">Processing...</p>
                <p className="text-xs text-c-text-2">{doneCount} of {totalCount} assets</p>
              </div>
            </div>
          )}

          {taggingComplete && !saveResult && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 mb-4">
              <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-green-500">Tagging Complete!</p>
                <p className="text-xs text-c-text-3">Click "Save All" to persist the tags to files</p>
              </div>
            </div>
          )}

          {saveResult && (
            <div className={`flex items-center gap-3 p-3 rounded-lg mb-4 border ${
              saveResult.failureCount === 0
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-yellow-500/10 border-yellow-500/30'
            }`}>
              {saveResult.failureCount === 0 ? (
                <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
              ) : (
                <AlertCircle size={18} className="text-yellow-500 flex-shrink-0" />
              )}
              <div className="text-sm">
                <p className={`font-medium ${saveResult.failureCount === 0 ? 'text-green-500' : 'text-yellow-500'}`}>
                  Saved: {saveResult.successCount} succeeded{saveResult.failureCount > 0 ? `, ${saveResult.failureCount} failed` : ''}
                </p>
                {saveResult.errors?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {saveResult.errors.slice(0, 3).map((err, idx) => (
                      <p key={idx} className="text-xs text-c-text-3">{err.assetName}: {err.error}</p>
                    ))}
                    {saveResult.errors.length > 3 && (
                      <p className="text-xs text-c-text-4">... and {saveResult.errors.length - 3} more</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected Assets Count */}
          <div className="mb-4">
            <p className="text-sm font-medium text-c-text-2 mb-2">
              Selected Assets: {selectedIds.size} of {pool.length}
            </p>
            {selectedIds.size === 0 && (
              <p className="text-xs text-c-text-4">No assets selected. Select at least one asset to tag.</p>
            )}
          </div>

          {/* List of selected assets — preview + name + per-asset status */}
          {selectedIds.size > 0 && (
            <div className="border border-c-border rounded-lg divide-y divide-c-border/60 max-h-72 overflow-y-auto scrollbar-thin">
              {selectedAssets.map(asset => {
                const status      = statusMap.get(asset.id)
                const previewPath = asset.thumbnail_path || asset.mp4_path
                const isVideo     = !asset.thumbnail_path && !!asset.mp4_path
                const previewSrc  = previewPath
                  ? `file:///${previewPath.replace(/\\/g, '/').replace(/^\w:/, m => m.toLowerCase())}`
                  : null
                return (
                  <div key={asset.id} className="flex items-center gap-3 px-3 py-2">
                    {/* Thumbnail */}
                    <div className="relative w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-c-base border border-c-border">
                      {previewSrc ? (
                        isVideo ? (
                          <video src={previewSrc} muted className="w-full h-full object-cover" />
                        ) : (
                          <img
                            src={previewSrc}
                            alt={asset.name}
                            className="w-full h-full object-cover"
                            onError={e => { e.target.style.display = 'none' }}
                          />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-c-text-4">
                          No Preview
                        </div>
                      )}
                    </div>

                    {/* Name */}
                    <span className="flex-1 text-xs text-c-text truncate">{asset.name}</span>

                    {/* Per-asset status */}
                    <div className="flex-shrink-0">
                      {status?.status === 'processing' && (
                        <Loader size={14} className="text-c-accent animate-spin" />
                      )}
                      {status?.status === 'done' && (
                        <CheckCircle size={14} className="text-green-500" />
                      )}
                      {status?.status === 'error' && (
                        <AlertCircle
                          size={14}
                          className="text-red-500"
                          title={typeof status.error === 'string' ? status.error : JSON.stringify(status.error)}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-c-border flex-shrink-0 bg-c-raised">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium
              bg-c-base text-c-text border border-c-border
              hover:bg-c-hover transition-colors"
          >
            Cancel
          </button>

          {!taggingComplete ? (
            <button
              onClick={handleStartTagging}
              disabled={selectedIds.size === 0 || isRunning}
              className={`ml-auto px-4 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-2 transition-all
                ${selectedIds.size === 0 || isRunning
                  ? 'bg-c-accent/50 text-c-on-accent/50 cursor-not-allowed'
                  : 'bg-c-accent text-c-on-accent hover:bg-c-accent-h'
                }`}
            >
              {isRunning && <Loader size={14} className="animate-spin" />}
              {isRunning ? 'Processing...' : 'Start Tagging'}
            </button>
          ) : (
            <button
              onClick={handleSaveAll}
              disabled={saveInProgress}
              className={`ml-auto px-4 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-2 transition-all
                ${saveInProgress
                  ? 'bg-c-accent/50 text-c-on-accent/50 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
                }`}
            >
              {saveInProgress && <Loader size={14} className="animate-spin" />}
              {saveInProgress ? 'Saving...' : 'Save All'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}