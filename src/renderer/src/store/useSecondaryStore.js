import { create } from 'zustand'

// Independent pane state for the secondary (right) browse panel.
//
// Shares the same pack/tree as the main store (Sidebar/Grid read tree +
// activePackIndex from useAssetStore directly), but keeps its OWN selected
// style, category, and asset list — so the team can browse a second category
// without disturbing the main panel. View-only: no search, no batch tagging.
//
// It intentionally mirrors the slice of useAssetStore that Sidebar, AssetGrid,
// and AssetCard read, so those components work unchanged when pointed here.
const useSecondaryStore = create((set, get) => ({
  selectedStyleId:    null,
  selectedCategory:   null,
  highlightedAssetId: null,
  assets:             [],
  assetsLoading:      false,
  error:              null,

  // Search fields are read by AssetGrid; kept inert so it renders plain assets.
  searchQuery:   '',
  searchResults: [],
  searchLoading: false,
  isSearchMode:  false,
  searchMode:    'keyword',

  selectStyle: (styleId) => set({ selectedStyleId: styleId }),
  clearSearch: () => {},            // no-op — secondary panel has no search

  selectCategory: async (category) => {
    if (!category) {
      set({ selectedCategory: null, assets: [], assetsLoading: false })
      return
    }
    set({ selectedCategory: category, assetsLoading: true, error: null })
    try {
      const result = await window.api.getAssetsByCategory(category.id)
      if (result.success) set({ assets: result.data, assetsLoading: false })
      else set({ assets: [], assetsLoading: false, error: result.error })
    } catch (err) {
      set({ assets: [], assetsLoading: false, error: err.message })
    }
  },

  reloadCurrentCategory: async () => {
    const { selectedCategory } = get()
    if (!selectedCategory) return
    try {
      const result = await window.api.getAssetsByCategory(selectedCategory.id)
      if (result.success) set({ assets: result.data })
    } catch {}
  },

  // Opening a file is workspace-global behavior; mirror the main store's action.
  openAsset: async (filePath) => {
    if (!filePath) return
    await window.api.openAssetFile(filePath)
  },

  // Called when the pack changes — the old selection no longer matches the tree.
  reset: () => set({
    selectedStyleId: null, selectedCategory: null, assets: [], assetsLoading: false,
  }),
}))

export default useSecondaryStore
