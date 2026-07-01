import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useAISidebarStore = create(
  persist(
    (set, get) => ({
  messages:  [],
  isLoading: false,
  isOpen:    false,
  width:     320,  // px, persisted

  // ─── SEARCH RESULTS ──────────────────────────────────────────
  ragResults:   [],     // grouped by asset_type
  ragError:     null,
  ragQuery:     '',
  hasSearched:  false,

  addMessage:     (msg)      => set(state => ({ messages: [...state.messages, msg] })),
  clearChat:      ()         => set({ messages: [], ragResults: [], ragError: null, ragQuery: '', hasSearched: false }),
  clearMessages:  ()         => set({ messages: [] }),
  setIsOpen:      (isOpen)   => set({ isOpen }),
  toggleSidebar:  ()         => set(state => ({ isOpen: !state.isOpen })),
  setWidth:       (width)    => set({ width }),
  setLoading:     (loading)  => set({ isLoading: loading }),

  // ─── RAG SEMANTIC SEARCH ─────────────────────────────────────
  // Scoped by styleId only — no category/asset-type required.
  // NOTE: do NOT append asset_type to the query. Doing so biased every
  // search toward whatever category the user last clicked (e.g. always
  // appending "animation" or "inspiration"), which combined with the
  // type-weight boost in rag_server.py drowned out the actual query.
  ragSearch: async (query, styleId) => {
    const trimmed = query.trim()
    if (!trimmed || styleId == null) return

    set({ isLoading: true, ragError: null, ragQuery: trimmed, hasSearched: false })

    try {
      const result = await window.api.ragSearch({ query: trimmed, styleId, limit: 20 })

      if (!result.success) {
        set({ ragResults: [], ragError: result.error, isLoading: false, hasSearched: true })
        return
      }

      // Group results by asset_type
      const grouped = {}
      for (const asset of (result.data || [])) {
        const type = asset.rag_asset_type || 'other'
        if (!grouped[type]) grouped[type] = []
        grouped[type].push(asset)
      }

      set({ ragResults: grouped, isLoading: false, hasSearched: true })
    } catch (err) {
      set({ ragResults: [], ragError: err.message, isLoading: false, hasSearched: true })
    }
  },
}),
    { name: 'ai-sidebar-state' }
  )
)

export default useAISidebarStore