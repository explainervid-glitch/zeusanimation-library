import { create } from 'zustand'

const MAX_PATHS = 5

// Label & filename template — hardcoded, tidak bisa diubah user
export const TEMPLATE_DEFS = [
  { id: 'anim_2d', label: '2D Animation',  filename: 'tmp_2d_animation.fla'   },
  { id: 'bg_2d',   label: '2D Background', filename: 'tmp_2d_background.fla'  },
  { id: 'anim_3d', label: '3D Animation',  filename: 'tmp_3d_animation.blend' },
  { id: 'bg_3d',   label: '3D Background', filename: 'tmp_3d_background.blend'},
]

const useSettingsStore = create((set, get) => ({
  isOpen:  false,
  loading: false,
  saved:   false,

  assetPaths:      [{ label: 'Pack 1', path: '' }],
  activePathIndex: 1,
  templatePaths: TEMPLATE_DEFS.map(t => ({ id: t.id, path: '' })),
  taggerUrl:      'http://192.168.1.27:8000',
  taggerVideoUrl: 'http://192.168.1.27:8001',
  ragUrl:         'http://192.168.1.27:8001',

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
          taggerVideoUrl:  d.taggerVideoUrl  ?? 'http://192.168.1.27:8001',
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
  updateTaggerVideoUrl: (url) => set({ taggerVideoUrl: url }),
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
    const { assetPaths, activePathIndex, templatePaths, taggerUrl, taggerVideoUrl, ragUrl } = get()
    set({ loading: true })
    try {
      const result = await window.api.saveSettings({ assetPaths, activePathIndex, templatePaths, taggerUrl, taggerVideoUrl, ragUrl })
      if (result.success) {
        set({ loading: false, saved: true })
        setTimeout(() => set({ saved: false }), 2000)
      }
    } catch (err) {
      console.error('saveSettings error:', err)
      set({ loading: false })
    }
  },
}))

export default useSettingsStore