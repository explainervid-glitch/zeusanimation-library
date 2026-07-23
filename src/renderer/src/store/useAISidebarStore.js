import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useAISidebarStore = create(
  persist(
    (set, get) => ({
  messages:  [],
  isLoading: false,
  isOpen:    false,
  width:     320,  // px, persisted
  posX:      null, // px, persisted (null = default top-right position)
  posY:      null,

  // ─── FLOATING ACTION BUTTON (draggable, iOS-style) ───────────
  fabX:      null, // px, persisted (null = default bottom-right)
  fabY:      null,

  // ─── SEARCH RESULTS ──────────────────────────────────────────
  ragResults:   [],     // grouped by asset_type
  ragError:     null,
  ragQuery:     '',
  hasSearched:  false,

  // ─── LLM RECOMMENDATION (generated from the results) ─────────
  genText:      '',
  genLoading:   false,
  genError:     null,

  // ─── SCRIPT → STORYBOARD ─────────────────────────────────────
  mode:         'script',   // 'search' | 'script'  (Script is the default)
  script:       '',
  scenes:       [],         // [{ id, query, description, assets, loading, error }]
  storyLoading: false,      // true while decomposing the script into scenes
  storyError:   null,

  // LLM OUTPUT language ('id' | 'en'). RAG search always uses English.
  lang:         'id',

  addMessage:     (msg)      => set(state => ({ messages: [...state.messages, msg] })),
  clearChat:      ()         => set({ messages: [], ragResults: [], ragError: null, ragQuery: '', hasSearched: false, genText: '', genLoading: false, genError: null, scenes: [], storyError: null, storyLoading: false }),
  clearMessages:  ()         => set({ messages: [] }),
  setIsOpen:      (isOpen)   => set({ isOpen }),
  toggleSidebar:  ()         => set(state => ({ isOpen: !state.isOpen })),
  setWidth:       (width)    => set({ width }),
  setPos:         (posX, posY) => set({ posX, posY }),
  setFabPos:      (fabX, fabY) => set({ fabX, fabY }),
  setLoading:     (loading)  => set({ isLoading: loading }),
  setMode:        (mode)     => set({ mode }),
  setScript:      (script)   => set({ script }),
  setLang:        (lang)     => set({ lang }),

  // ─── RAG SEMANTIC SEARCH ─────────────────────────────────────
  // Scoped by styleId only — no category/asset-type required.
  // NOTE: do NOT append asset_type to the query. Doing so biased every
  // search toward whatever category the user last clicked (e.g. always
  // appending "animation" or "inspiration"), which combined with the
  // type-weight boost in rag_server.py drowned out the actual query.
  ragSearch: async (query, styleId) => {
    const trimmed = query.trim()
    if (!trimmed || styleId == null) return

    set({ isLoading: true, ragError: null, ragQuery: trimmed, hasSearched: false,
          genText: '', genError: null, genLoading: false })

    try {
      const result = await window.api.ragSearch({ query: trimmed, styleId, limit: 20 })

      if (!result.success) {
        set({ ragResults: [], ragError: result.error, isLoading: false, hasSearched: true })
        return
      }

      const flat = result.data || []

      // Group results by asset_type
      const grouped = {}
      for (const asset of flat) {
        const type = asset.rag_asset_type || 'other'
        if (!grouped[type]) grouped[type] = []
        grouped[type].push(asset)
      }

      set({ ragResults: grouped, isLoading: false, hasSearched: true })

      // Kick off the LLM recommendation — non-blocking, so the result list
      // shows immediately and the recommendation fills in when it's ready.
      if (flat.length) {
        set({ genLoading: true, genText: '', genError: null })
        window.api.aiGenerate({ query: trimmed, results: flat, lang: get().lang })
          .then(gen => {
            if (gen?.success) set({ genText: gen.text || '', genLoading: false })
            else set({ genError: gen?.error || 'Generation failed', genLoading: false })
          })
          .catch(err => set({ genError: err.message, genLoading: false }))
      }
    } catch (err) {
      set({ ragResults: [], ragError: err.message, isLoading: false, hasSearched: true })
    }
  },

  // ─── SCRIPT → STORYBOARD ─────────────────────────────────────
  // 1) LLM decomposes the script into scenes. 2) Each scene runs a RAG search
  // to pull matching assets, filling in one scene at a time.
  runStoryboard: async (script, styleId) => {
    const trimmed = (script || '').trim()
    if (!trimmed || styleId == null) return

    set({ storyLoading: true, storyError: null, scenes: [] })
    try {
      const res = await window.api.aiScenes({ script: trimmed, lang: get().lang })
      if (!res?.success) {
        set({ storyError: res?.error || 'Could not break the script into scenes.', storyLoading: false })
        return
      }

      // Each scene has an English `query` (for RAG) and a `description` (display).
      const scenes = (res.scenes || []).map((s, i) => ({
        id: i, query: s.query, description: s.description, assets: [], loading: true, error: null,
      }))
      set({ scenes, storyLoading: false })

      // Retrieve assets scene-by-scene (sequential — keeps the RAG server calm).
      for (let i = 0; i < scenes.length; i++) {
        try {
          const r = await window.api.ragSearch({ query: scenes[i].query, styleId, limit: 8 })
          set(state => ({
            scenes: state.scenes.map((s, idx) => idx === i
              ? { ...s, assets: r?.success ? (r.data || []) : [], loading: false, error: r?.success ? null : r?.error }
              : s),
          }))
        } catch (e) {
          set(state => ({
            scenes: state.scenes.map((s, idx) => idx === i ? { ...s, loading: false, error: e.message } : s),
          }))
        }
      }
    } catch (err) {
      set({ storyError: err.message, storyLoading: false })
    }
  },
}),
    {
      name: 'ai-sidebar-state',
      // Persist ONLY the UI prefs. Transient search/generation state
      // (isLoading, genLoading, results, ragQuery…) must never persist — else
      // closing the app mid-search leaves a "Searching…" spinner stuck on the
      // next launch. `merge` also ignores those fields from any stale blob.
      partialize: (state) => ({ isOpen: state.isOpen, width: state.width, posX: state.posX, posY: state.posY, fabX: state.fabX, fabY: state.fabY, lang: state.lang }),
      merge: (persisted, current) => ({
        ...current,
        isOpen: persisted?.isOpen ?? current.isOpen,
        width:  persisted?.width  ?? current.width,
        posX:   persisted?.posX   ?? current.posX,
        posY:   persisted?.posY   ?? current.posY,
        fabX:   persisted?.fabX   ?? current.fabX,
        fabY:   persisted?.fabY   ?? current.fabY,
        lang:   persisted?.lang   ?? current.lang,
      }),
    }
  )
)

export default useAISidebarStore