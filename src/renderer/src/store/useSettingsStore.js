import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_PATHS = 5

// Label & filename template — hardcoded, tidak bisa diubah user
export const TEMPLATE_DEFS = [
  { id: 'anim_2d', label: '2D Animation',  filename: 'tmp_2d_animation.fla'   },
  { id: 'bg_2d',   label: '2D Background', filename: 'tmp_2d_background.fla'  },
  { id: 'anim_3d', label: '3D Animation',  filename: 'tmp_3d_animation.blend' },
  { id: 'bg_3d',   label: '3D Background', filename: 'tmp_3d_background.blend'},
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

      assetPaths:      [{ label: 'Pack 1', path: '' }],
      activePathIndex: 0,
      templatePaths: TEMPLATE_DEFS.map(t => ({ id: t.id, path: '' })),
      taggerUrl:      'http://192.168.1.27:8000',
      ragUrl:         'http://192.168.1.27:8001',

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
              assetPaths:      d.assetPaths      ?? [{ label: 'Pack 1', path: '' }],
              activePathIndex: d.activePathIndex ?? 0,
              templatePaths:   mergedTemplates,
              taggerUrl:       d.taggerUrl       ?? 'http://192.168.1.27:8000',
              ragUrl:          d.ragUrl          ?? 'http://192.168.1.27:8001',
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
  addPath: () => {
    const { assetPaths } = get()
    if (assetPaths.length >= MAX_PATHS) return
    set({ assetPaths: [...assetPaths, { label: `Pack ${assetPaths.length + 1}`, path: '' }] })
  },

  removePath: (index) => {
    const { assetPaths, activePathIndex } = get()
    if (assetPaths.length <= 1) return
    const newPaths  = assetPaths.filter((_, i) => i !== index)
    const newActive = activePathIndex >= newPaths.length ? newPaths.length - 1
      : activePathIndex === index ? 0
      : activePathIndex > index  ? activePathIndex - 1
      : activePathIndex
    set({ assetPaths: newPaths, activePathIndex: newActive })
  },

  updatePathValue: (index, path) => {
    const { assetPaths } = get()
    set({ assetPaths: assetPaths.map((p, i) => i === index ? { ...p, path } : p) })
  },

  browsePath: async (index) => {
    const result = await window.api.selectFolder()
    if (result.success) {
      const { assetPaths } = get()
      set({ assetPaths: assetPaths.map((p, i) => i === index ? { ...p, path: result.data } : p) })
    }
  },

  // ─── TAGGER ───────────────────────────────────────────────────
  updateTaggerUrl:      (url) => set({ taggerUrl: url }),
  updateRagUrl:         (url) => set({ ragUrl: url }),

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
    const { assetPaths, activePathIndex, templatePaths, taggerUrl, ragUrl } = get()
    set({ loading: true })
    try {
      const result = await window.api.saveSettings({ assetPaths, activePathIndex, templatePaths, taggerUrl, ragUrl })
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