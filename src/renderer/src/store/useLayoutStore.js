import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Split-view layout state (persisted). splitRatio = secondary panel width as a
// fraction of the content row, clamped to a sane range.
const useLayoutStore = create(
  persist(
    (set) => ({
      splitOpen:  false,
      splitRatio: 0.5,

      toggleSplit:   ()  => set((s) => ({ splitOpen: !s.splitOpen })),
      setSplitOpen:  (v) => set({ splitOpen: v }),
      setSplitRatio: (r) => set({ splitRatio: Math.min(0.75, Math.max(0.25, r)) }),
    }),
    { name: 'layout-store' }
  )
)

export default useLayoutStore
