import { create } from 'zustand'

const useAssetStore = create((set, get) => ({
  tree: [],
  selectedCategory:   null,
  selectedStyleId:    null,  // top-level style id — used by AISearch (no category needed)
  highlightedAssetId: null,   // asset.id to scroll+highlight after navigation
  assets: [],
  treeLoading:    false,
  assetsLoading:  false,
  scanning:       false,
  scanLogs:       [],
  error:          null,
  activePackIndex: 0,
  packNeedsRescan: false,

  // ─── SEARCH ──────────────────────────────────────────────────
  searchQuery:   '',
  searchResults: [],
  searchLoading: false,
  isSearchMode:  false,
  searchMode:    'keyword',   // 'keyword' | 'semantic'

  setSearchQuery: async (query) => {
    const { selectedCategory, selectedStyleId, searchMode } = get()
    const trimmed = query.trim()

    if (!trimmed) {
      set({ searchQuery: '', searchResults: [], isSearchMode: false, error: null })
      return
    }

    // ── AI Search (semantic) — scoped by STYLE only, no category needed ──
    if (searchMode === 'semantic') {
      if (selectedStyleId == null) {
        set({ searchQuery: trimmed, error: 'Select a style first' })
        return
      }

      set({ searchQuery: trimmed, searchLoading: true, isSearchMode: true, error: null })

      try {
        const result = await window.api.ragSearch({ query: trimmed, styleId: selectedStyleId, limit: 60 })
        if (result.success) {
          set({ searchResults: result.data, searchLoading: false })
        } else {
          set({ searchResults: [], searchLoading: false, error: result.error })
        }
      } catch (err) {
        set({ searchResults: [], searchLoading: false, error: err.message })
      }
      return
    }

    // ── Keyword search (FTS) — scoped by CATEGORY's style_type ──
    if (!selectedCategory?.style_type_id) {
      set({ searchQuery: trimmed })
      return
    }

    set({ searchQuery: trimmed, searchLoading: true, isSearchMode: true, error: null })

    try {
      const result = await window.api.searchAssets({
        styleTypeId: selectedCategory.style_type_id,
        query:       trimmed,
      })

      if (result.success) {
        set({ searchResults: result.data, searchLoading: false })
      } else {
        set({ searchResults: [], searchLoading: false, error: result.error })
      }
    } catch (err) {
      set({ searchResults: [], searchLoading: false, error: err.message })
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [], isSearchMode: false, searchMode: 'keyword' }),

  toggleSearchMode: () => {
    const { searchMode } = get()
    const next = searchMode === 'keyword' ? 'semantic' : 'keyword'
    set({ searchMode: next, searchResults: [], isSearchMode: false, searchQuery: '', error: null })
  },

  // ─── RAG SEMANTIC SEARCH ─────────────────────────────────────
  ragSearch: async (query) => {
    const { selectedStyleId } = get()
    const trimmed = query.trim()

    if (!trimmed) {
      set({ searchQuery: '', searchResults: [], isSearchMode: false })
      return
    }

    // Only a style needs to be selected — category is NOT required
    const styleId = selectedStyleId
    if (!styleId) {
      set({ searchQuery: trimmed, error: 'Select a style first' })
      return
    }

    set({ searchQuery: trimmed, searchLoading: true, isSearchMode: true })

    try {
      const result = await window.api.ragSearch({ query: trimmed, styleId, limit: 20 })
      if (result.success) {
        set({ searchResults: result.data, searchLoading: false })
      } else {
        set({ searchResults: [], searchLoading: false, error: result.error })
      }
    } catch (err) {
      set({ searchResults: [], searchLoading: false, error: err.message })
    }
  },

  // ─── LOAD TREE ───────────────────────────────────────────────
  loadTree: async () => {
    set({ treeLoading: true, error: null, packNeedsRescan: false })
    try {
      const result = await window.api.getAssetTree()
      if (result.success) {
        set({ tree: result.data, treeLoading: false })
      } else {
        set({ error: result.error, treeLoading: false })
      }
    } catch (err) {
      set({ error: err.message, treeLoading: false })
    }
  },

  // ─── SELECT CATEGORY ─────────────────────────────────────────
  // Navigate to a specific asset from RAG results:
  // finds its category in the tree, selects it, sets highlight id
  navigateToAsset: async (asset) => {
    const { tree, selectCategory } = get()
    if (!tree?.length) return

    // asset has category_id and style_type_id from DB row
    const categoryId   = asset.category_id
    const styleTypeId  = asset.style_type_id ?? asset.rag_style_type_id

    // Walk tree to find the matching category
    for (const style of tree) {
      for (const typeData of style.types || []) {
        for (const cat of typeData.categories || []) {
          if (cat.id === categoryId) {
            // Found — select this category (same shape as Sidebar uses)
            await selectCategory({
              ...cat,
              type:           typeData.type,
              styleId:        style.id,
              style_type_id:  typeData.id,
            })
            // Set highlight so AssetGrid can scroll to it
            set({ highlightedAssetId: asset.id })
            return
          }
        }
      }
    }
    console.warn('[navigateToAsset] Category not found for asset:', asset.id)
  },

  clearHighlight: () => set({ highlightedAssetId: null }),

  // ─── SELECT STYLE (top-level, no category needed) ────────────
  // Lifted from Sidebar local state so RAG search can scope to a
  // style even when no category is selected yet.
  selectStyle: (styleId) => set({ selectedStyleId: styleId }),

  selectCategory: async (category) => {
    // null = deselect (e.g. saat ganti style)
    if (!category) {
      set({ selectedCategory: null, assets: [], assetsLoading: false,
            searchQuery: '', searchResults: [], isSearchMode: false })
      return
    }
    set({
      selectedCategory: category,
      assetsLoading: true,
      error: null,
      searchQuery: '',
      searchResults: [],
      isSearchMode: false,
    })
    try {
      const result = await window.api.getAssetsByCategory(category.id)
      if (result.success) {
        set({ assets: result.data, assetsLoading: false })
      } else {
        set({ error: result.error, assetsLoading: false, assets: [] })
      }
    } catch (err) {
      set({ error: err.message, assetsLoading: false, assets: [] })
    }
  },

  // ─── RESCAN ──────────────────────────────────────────────────
  rescan: async () => {
    set({ scanning: true, scanLogs: [], error: null })

    // Listen log events dari scanner
    window.api.onScanLog((msg) => {
      set(s => ({ scanLogs: [...s.scanLogs, msg] }))
    })

    try {
      const result = await window.api.rescanAssets()
      window.api.offScanLog()
      if (result.success) {
        set({
          tree: result.data,
          scanning: false,
          selectedCategory:    null,
          highlightedAssetId:  null,
          assets: [],
          packNeedsRescan: false,
          searchQuery: '',
          searchResults: [],
          isSearchMode: false,
        })

        // RAG bulk index is NOT auto-triggered after rescan anymore —
        // it's a separate explicit action via the "Re-embed Assets" button,
        // which calls window.api.ragIndexBulk() directly.
      } else {
        set({ error: result.error, scanning: false })
      }
    } catch (err) {
      window.api.offScanLog()
      set({ error: err.message, scanning: false })
    }
  },

  // ─── SWITCH PACK ─────────────────────────────────────────────
  switchPack: async (index) => {
    set({
      treeLoading: true, error: null,
      selectedCategory:   null,
  assets: [],
      searchQuery: '', searchResults: [], isSearchMode: false,
    })
    try {
      const result = await window.api.switchPack(index)
      if (result.success) {
        set({
          tree:            result.data,
          activePackIndex: index,
          treeLoading:     false,
          packNeedsRescan: result.isEmpty === true,
        })
      } else {
        set({ error: result.error, treeLoading: false })
      }
    } catch (err) {
      set({ error: err.message, treeLoading: false })
    }
  },

  // ─── RENAME STYLE ────────────────────────────────────────────
  renameStyle: async (styleId, newName, newDescription) => {
    try {
      const result = await window.api.renameStyle({ styleId, newName, newDescription })
      if (result.success) { set({ tree: result.data }) }
      else { set({ error: result.error }) }
    } catch (err) { set({ error: err.message }) }
  },

  // ─── OPEN ASSET ──────────────────────────────────────────────
  openAsset: async (filePath) => {
    if (!filePath) { set({ error: 'File raw tidak tersedia untuk asset ini' }); return }
    const result = await window.api.openAssetFile(filePath)
    if (!result.success) set({ error: result.error })
  },

  setError:             (error) => set({ error }),
  clearError:           () => set({ error: null }),
  clearPackNeedsRescan: () => set({ packNeedsRescan: false }),

  // ─── REFRESH (manual / auto-poll) ────────────────────────────
  // Cek apakah DB di NAS berubah → reload tree + assets tanpa full rescan
  checkDbUpdated: async () => {
    const { selectedCategory } = get()
    try {
      const result = await window.api.checkDbUpdated({
        categoryId: selectedCategory?.id ?? null,
      })
      if (!result.updated) return false

      // DB berubah — update tree dan assets secara silent
      set(s => ({
        tree: result.tree ?? s.tree,
        assets: result.assets ?? s.assets,
      }))
      return true
    } catch { return false }
  },

  // Auto-poll — panggil sekali saat app mount
  startDbPolling: () => {
    const INTERVAL_MS = 15000  // 15 detik
    const id = setInterval(async () => {
      const { scanning, checkDbUpdated } = get()
      if (scanning) return  // skip saat rescan
      checkDbUpdated()
    }, INTERVAL_MS)
    set({ _pollId: id })
  },

  stopDbPolling: () => {
    const { _pollId } = get()
    if (_pollId) clearInterval(_pollId)
    set({ _pollId: null })
  },

  _pollId: null,

  // Reload assets array tanpa reset selectedCategory
  reloadCurrentCategory: async () => {
    const { selectedCategory } = get()
    if (!selectedCategory) return
    try {
      const result = await window.api.getAssetsByCategory(selectedCategory.id)
      if (result.success) set({ assets: result.data })
    } catch {}
  },
}))

export default useAssetStore