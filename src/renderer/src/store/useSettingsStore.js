import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import useAssetStore from './useAssetStore'


// Label & filename template — hardcoded, tidak bisa diubah user
export const TEMPLATE_DEFS = [
  { id: 'anim_2d', label: '2D Animation',  filename: 'tmp_2d_animation.fla'   },
  { id: 'bg_2d',   label: '2D Background', filename: 'tmp_2d_background.fla'  },
  { id: 'anim_3d', label: '3D Animation',  filename: 'tmp_3d_animation.blend' },
  { id: 'bg_3d',   label: '3D Background', filename: 'tmp_3d_background.blend'},
  // Own category, listed last — see DEFAULT_TEMPLATES in main/settings.js.
  { id: 'ae',      label: 'Ae',            filename: 'tmp_aftereffects.aep'   },
]

const useSettingsStore = create(
  persist(
    (set, get) => ({
      isOpen:  false,
      loading: false,
      saved:   false,

      // Theme: 'dark' | 'light'
      theme: 'light',

      // One-time theme intro popup (persisted). Shown until dismissed.
      themeIntroSeen: false,
      dismissThemeIntro: () => set({ themeIntroSeen: true }),

      // When ON: the Import button shows on character cards AND character cards
      // become import-only (clicking the card no longer opens the asset). When
      // OFF: the Import button is hidden and cards open on click as usual.
      importCharactersEnabled: false,
      setImportCharactersEnabled:    (v) => set({ importCharactersEnabled: v }),
      toggleImportCharactersEnabled: ()  => set(s => ({ importCharactersEnabled: !s.importCharactersEnabled })),

      // Character "Import" button behavior.
      // blenderImportEnabled (default off): when ON, Import copies the asset
      // into the project AND imports its collection into a running Blender.
      // When OFF, Import just copies into the project and opens the file.
      // blenderImportMode ('append' | 'link', default 'append'): which method
      // that Blender import uses. Only relevant when blenderImportEnabled.
      blenderImportEnabled: false,
      setBlenderImportEnabled:    (v) => set({ blenderImportEnabled: v }),
      toggleBlenderImportEnabled: ()  => set(s => ({ blenderImportEnabled: !s.blenderImportEnabled })),

      blenderImportMode: 'append',
      setBlenderImportMode:    (mode) => set({ blenderImportMode: mode }),
      toggleBlenderImportMode: ()     => set(s => ({ blenderImportMode: s.blenderImportMode === 'append' ? 'link' : 'append' })),

      // 2D Character path (Adobe Animate) on/off — the mockup's "2D Character
      // On/Off" under Compile. Phase 2: UI/state only.
      char2dImportEnabled: true,
      setChar2dImportEnabled:    (v) => set({ char2dImportEnabled: v }),
      toggleChar2dImportEnabled: ()  => set(s => ({ char2dImportEnabled: !s.char2dImportEnabled })),

      // Index Flow — style-to-style search/browse links. Default ON; a pack
      // with no indexflow.json has an empty graph, which resolves to the
      // original per-style behaviour, so this costs nothing until wired.
      //
      // Unlike the toggles above, this one is NOT renderer-only: main gates
      // every read path on it, so it has to reach settings.json immediately
      // rather than waiting for the Save button. Flipping it also recompiles
      // (or deletes) indexflow.db and returns a fresh tree.
      indexFlowEnabled: true,
      setIndexFlowEnabled: async (v) => {
        set({ indexFlowEnabled: v })
        try {
          const res = await window.api.setIndexFlowEnabled(v)
          // Main hands back the re-merged tree, so the sidebar switches over
          // without a second round trip or a rescan.
          if (res?.success && res.tree) useAssetStore.setState({ tree: res.tree })
          return res
        } catch (err) {
          console.error('setIndexFlowEnabled error:', err)
          set({ indexFlowEnabled: !v })   // roll back — main is the source of truth
          return { success: false, error: err.message }
        }
      },


      // Asset paths are hardcoded in src/shared/PathConfig.js — read-only here.
      assetPaths:      [],
      activePathIndex: 0,
      templatePaths: TEMPLATE_DEFS.map(t => ({ id: t.id, path: '' })),
      taggerUrl:      'http://192.168.1.27:8000',
      ragUrl:         'http://192.168.1.27:8001',
      llmUrl:         'http://192.168.1.27:8002',

      // ─── THEME ────────────────────────────────────────────────────
      setTheme: (theme) => {
        set({ theme })
        applyThemeToDocument(theme)
      },
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: next })
        applyThemeToDocument(next)
      },

      // ─── OPEN / CLOSE ─────────────────────────────────────────────
      openSettings: async () => {
        set({ isOpen: true, loading: true, saved: false })
        try {
          const result = await window.api.getSettings()
          if (result.success) {
            const d = result.data
            // Merge templatePaths dari server dengan TEMPLATE_DEFS
            const mergedTemplates = TEMPLATE_DEFS.map(t => {
              const saved = d.templatePaths?.find(s => s.id === t.id)
              return { id: t.id, path: saved?.path || '' }
            })
            set({
              assetPaths:      d.assetPaths      ?? [],
              activePathIndex: d.activePathIndex ?? 0,
              templatePaths:   mergedTemplates,
              taggerUrl:       d.taggerUrl       ?? 'http://192.168.1.27:8000',
              ragUrl:          d.ragUrl          ?? 'http://192.168.1.27:8001',
              llmUrl:          d.llmUrl          ?? 'http://192.168.1.27:8002',
              // settings.json wins: main gates the feature on this value, so a
              // stale localStorage copy must not disagree with it. Compared
              // against false, not true — only an explicit opt-out disables it,
              // a missing key follows the ON default.
              indexFlowEnabled: d.indexFlowEnabled !== false,
              loading: false,
            })
          }
        } catch (err) {
          console.error('getSettings error:', err)
          set({ loading: false })
        }
      },

  closeSettings: () => set({ isOpen: false, saved: false }),

  // ─── ASSET PATHS ──────────────────────────────────────────────
  // ─── TAGGER ───────────────────────────────────────────────────
  updateTaggerUrl:      (url) => set({ taggerUrl: url }),
  updateRagUrl:         (url) => set({ ragUrl: url }),
  updateLlmUrl:         (url) => set({ llmUrl: url }),

  // ─── TEMPLATE PATHS ───────────────────────────────────────────
  updateTemplatePath: (id, path) => {
    const { templatePaths } = get()
    set({ templatePaths: templatePaths.map(t => t.id === id ? { ...t, path } : t) })
  },

  browseTemplatePath: async (id) => {
    const result = await window.api.selectFile()
    if (result.success) {
      const { templatePaths } = get()
      set({ templatePaths: templatePaths.map(t => t.id === id ? { ...t, path: result.data } : t) })
    }
  },

  // ─── SAVE ─────────────────────────────────────────────────────
  saveSettings: async () => {
    const { activePathIndex, templatePaths, taggerUrl, ragUrl, llmUrl } = get()
    set({ loading: true })
    try {
      const result = await window.api.saveSettings({ activePathIndex, templatePaths, taggerUrl, ragUrl, llmUrl })
      if (result.success) {
        set({ loading: false, saved: true })
        setTimeout(() => set({ saved: false }), 2000)
      }
    } catch (err) {
      console.error('saveSettings error:', err)
      set({ loading: false })
    }
  },
}),
    {
      name: 'settings-store',  // localStorage key for persist
      // v1: drops the removed autoResolveConflict flag (an auto-clicker for
      // Animate's conflict dialog). It could press Enter on the wrong modal,
      // so the feature is gone — clear any persisted copy.
      version: 1,
      migrate: (persisted) => {
        if (persisted) delete persisted.autoResolveConflict
        return persisted
      },
    }
  )
)

// ─── Helper: apply theme class to document ────────────────────
function applyThemeToDocument(theme) {
  const root = document.getElementById('root')
  if (!root) return
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(`theme-${theme}`)
}

// Apply theme on store rehydration
useSettingsStore.subscribe((state) => {
  applyThemeToDocument(state.theme)
})

// Apply initial theme
applyThemeToDocument(useSettingsStore.getState().theme)

export default useSettingsStore