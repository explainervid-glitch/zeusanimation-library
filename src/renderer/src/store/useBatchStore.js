import { create } from 'zustand'
import { playChime } from '../lib/sound'

// Fresh (empty) batch state. A function so each reset gets its own Set/Map.
const freshBatchState = () => ({
  isBatchMode:    false,
  isModalOpen:    false,
  batchAssets:    [],
  batchAssetType: null,
  batchTargets:   [],
  selectedIds:    new Set(),
  statusMap:      new Map(),
  resultsMap:     new Map(),
  isRunning:      false,
  doneCount:      0,
  totalCount:     0,
})

// Status per asset: idle | queued | processing | done | error
const useBatchStore = create((set, get) => ({
  // ── Mode ──────────────────────────────────────────────────────
  isBatchMode: false,

  // Modal visibility — store-driven so the sidebar can open it too.
  isModalOpen: false,

  // Asset pool for the current batch. Empty = the modal falls back to the
  // active category's assets (classic per-category flow). Populated by
  // startTypeBatch to tag a whole asset type across all its categories.
  batchAssets:    [],
  batchAssetType: null,

  // Asset objects captured when a run starts, so the panel + Save All keep
  // working even if the user navigates to another category while tagging runs.
  batchTargets:   [],

  // ── Selection ─────────────────────────────────────────────────
  selectedIds: new Set(),   // Set<assetId>

  // ── Progress per asset ────────────────────────────────────────
  // Map<assetId, { status, error? }>
  statusMap: new Map(),
  // ── Results per asset (tagged data from AI) ────────────────────
  // Map<assetId, { success, data }>
  resultsMap: new Map(),
  // ── Running state ─────────────────────────────────────────────
  isRunning:   false,
  doneCount:   0,
  totalCount:  0,

  // ─────────────────────────────────────────────────────────────
  // Invalidated on reset/new run so an in-flight loop stops writing to the store.
  _runToken: 0,

  enterBatchMode: () => set(s => ({
    ...freshBatchState(),
    isBatchMode: true,
    _runToken:   s._runToken + 1,
  })),

  // Full teardown — clears everything, closes the tray, and stops any run.
  resetBatch: () => set(s => ({
    ...freshBatchState(),
    _runToken: s._runToken + 1,
  })),

  // Leave SELECTION mode only. If a run is in flight (or finished with unsaved
  // results), keep the tray + progress alive so the user can carry on working —
  // edit assets, browse — while it finishes, and still Save All afterwards.
  exitBatchMode: () => set(s => {
    if (s.isRunning || s.resultsMap.size > 0) {
      return { isBatchMode: false, selectedIds: new Set() }
    }
    return { ...freshBatchState(), _runToken: s._runToken + 1 }
  }),

  openModal:  () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  // Batch-tag an entire asset type: seed the pool with every asset across the
  // type's categories, select all, and open the modal.
  startTypeBatch: (assets, assetType) => set({
    isBatchMode:    true,
    isModalOpen:    true,
    batchAssets:    assets,
    batchAssetType: assetType,
    batchTargets:   [],
    selectedIds:    new Set(assets.map(a => a.id)),
    statusMap:      new Map(),
    resultsMap:     new Map(),
    isRunning:      false,
    doneCount:      0,
    totalCount:     0,
  }),

  toggleSelect: (assetId) => set(state => {
    const next = new Set(state.selectedIds)
    if (next.has(assetId)) next.delete(assetId)
    else next.add(assetId)
    return { selectedIds: next }
  }),

  selectAll: (assetIds) => set({
    selectedIds: new Set(assetIds),
  }),

  deselectAll: () => set({
    selectedIds: new Set(),
  }),

  // ─── Run batch ────────────────────────────────────────────────
  runBatch: async (assets, assetType, onAssetDone) => {
    const { selectedIds } = get()
    if (selectedIds.size === 0 || get().isRunning) return

    const targets = assets.filter(a => selectedIds.has(a.id))
    if (!targets.length) return

    // Init statusMap semua ke queued
    const initMap = new Map(targets.map(a => [a.id, { status: 'queued' }]))
    const initResults = new Map()
    const token = get()._runToken + 1
    set({ _runToken: token, isRunning: true, statusMap: initMap, resultsMap: initResults, totalCount: targets.length, doneCount: 0, batchTargets: targets })

    for (const asset of targets) {
      // Bail if this run was cancelled (resetBatch) or superseded by a new one.
      if (get()._runToken !== token) return

      // Tandai processing
      set(s => {
        const m = new Map(s.statusMap)
        m.set(asset.id, { status: 'processing' })
        return { statusMap: m }
      })

      // ── Route to correct tagger based on asset type ───────────
      // animation → /auto-tag-video  (new_main.py, port 8000)
      // background / character / inspiration → /auto-tag  (new_main.py, port 8000)
      const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi']
      const isVideo = (p) => p && VIDEO_EXTS.some(e => p.toLowerCase().endsWith(e))

      let result
      if (assetType === 'animation') {
        const videoPath = isVideo(asset.mp4_path)  ? asset.mp4_path
                        : isVideo(asset.raw_path)  ? asset.raw_path
                        : null
        if (!videoPath) {
          result = { success: false, error: 'No mp4 preview found for this animation asset' }
        } else {
          result = await window.api.taggerGenerateVideo({
            videoPath,
            jsonPath:  asset.json_path || '',
            filename:  asset.name,
          })
        }
      } else {
        // background, character, inspiration — all use image tagger
        const thumbPath = asset.thumbnail_path || asset.mp4_path || asset.raw_path
        if (!thumbPath) {
          result = { success: false, error: 'No preview image found for this asset' }
        } else {
          result = await window.api.taggerGenerate({
            thumbnailPath: thumbPath,
            jsonPath:      asset.json_path || '',
            assetType,
          })
        }
      }

      set(s => {
        const m = new Map(s.statusMap)
        const r = new Map(s.resultsMap)
        // Always coerce error to string — FastAPI can return objects
        const errMsg = result.success ? null
          : typeof result.error === 'string' ? result.error
          : JSON.stringify(result.error)
        m.set(asset.id, result.success
          ? { status: 'done' }
          : { status: 'error', error: errMsg }
        )
        // Store result data for later save
        r.set(asset.id, result)
        return { statusMap: m, resultsMap: r, doneCount: s.doneCount + 1 }
      })

      // Callback agar AssetCard bisa update preview
      if (result.success && onAssetDone) {
        onAssetDone(asset.id, result.data)
      }
    }

    // Only clear the flag if this run is still the current one. The token guard
    // also means a cancelled or superseded run (resetBatch / a new run) stays
    // silent — the chime marks a batch that actually ran to the end.
    if (get()._runToken === token) {
      set({ isRunning: false })
      playChime()
    }
  },

  // ─── Save all results to JSON ─────────────────────────────────
  saveAllResults: async () => {
    // Use the captured batch targets so saving works even if the user has
    // navigated to another category while tagging ran.
    const { resultsMap, batchTargets } = get()
    const results = { successCount: 0, failureCount: 0, errors: [] }

    for (const [assetId, result] of resultsMap.entries()) {
      if (!result.success) continue

      const asset = batchTargets.find(a => a.id === assetId)
      if (!asset) continue

      try {
        await window.api.writeAssetJson({
          jsonPath: asset.json_path,
          assetId,
          data: result.data,
        })
        results.successCount++
      } catch (err) {
        results.failureCount++
        results.errors.push({ assetId, assetName: asset.name, error: err.message })
      }
    }

    return results
  },
}))

export default useBatchStore