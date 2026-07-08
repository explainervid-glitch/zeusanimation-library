import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Factory so each panel can own an independent collapse/width state, each
// persisted under its own key.
function createSidebarStore(persistName) {
  return create(
    persist(
      (set) => ({
        isOpen: true,
        width: 206,  // Fits exactly one style pill (150px) + buttons + padding

        toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
        setSidebarWidth: (width) => set({ width }),
        setOpen: (isOpen) => set({ isOpen }),
      }),
      { name: persistName }
    )
  )
}

// Main panel sidebar (default export keeps existing imports working).
const useSidebarStore = createSidebarStore('sidebar-state')
export default useSidebarStore

// Secondary panel sidebar — independent persisted state.
export const useSecondarySidebarStore = createSidebarStore('sidebar-state-secondary')
