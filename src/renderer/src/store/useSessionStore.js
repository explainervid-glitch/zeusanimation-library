import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Remembers the last MAIN-panel view so the app reopens where you left off:
// which pack + style + category, and which sidebar type sections were expanded.
// Kept separate from useAssetStore so we only persist this small snapshot,
// never the transient tree/assets/loading state.
const useSessionStore = create(
  persist(
    (set) => ({
      packIndex:   0,
      styleId:     null,
      category:    null,      // full category object (needs .id to re-select)
      openTypeIds: [],        // ids of expanded TypeSections in the sidebar

      setView: ({ packIndex, styleId, category }) =>
        set({ packIndex, styleId, category }),

      toggleOpenType: (id, isOpen) =>
        set((state) => ({
          openTypeIds: isOpen
            ? Array.from(new Set([...state.openTypeIds, id]))
            : state.openTypeIds.filter((x) => x !== id),
        })),
    }),
    { name: 'session-view' }
  )
)

export default useSessionStore
