import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useSidebarStore = create(
  persist(
    (set) => ({
      isOpen: true,
      width: 206,  // Fits exactly one style pill (150px) + buttons + padding

      toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
      setSidebarWidth: (width) => set({ width }),
      setOpen: (isOpen) => set({ isOpen }),
    }),
    {
      name: 'sidebar-state',
    }
  )
)

export default useSidebarStore
