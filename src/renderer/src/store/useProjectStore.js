import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The currently active project (folder created via "Add → Project", or picked
// from the bottom bar). Persisted so it survives restarts. Shape: { name, path }.
const useProjectStore = create(
  persist(
    (set) => ({
      activeProject: null,

      setActiveProject:   (project) => set({ activeProject: project }),
      clearActiveProject: ()        => set({ activeProject: null }),
    }),
    { name: 'project-store' }
  )
)

export default useProjectStore
