import { create } from 'zustand'

// "Compile" (3D pack only): pick one Character + one Movement asset, then run
// Import-character → Append-movement into Blender's Temporary scene in one go.
// Session-only state (not persisted).
const useCompileStore = create((set) => ({
  isCompileMode: false,
  character: null,   // asset row, type 'character'
  movement:  null,   // asset row, type 'animation' (movement)

  enterCompileMode:  () => set({ isCompileMode: true }),
  exitCompileMode:   () => set({ isCompileMode: false, character: null, movement: null }),
  toggleCompileMode: () => set((s) =>
    s.isCompileMode
      ? { isCompileMode: false, character: null, movement: null }
      : { isCompileMode: true }
  ),

  // Route a clicked asset into its slot by category type. Clicking another
  // asset of the same type replaces the slot. Other types are ignored.
  pickAsset: (asset, type) => {
    if (type === 'character')      set({ character: asset })
    else if (type === 'animation') set({ movement: asset })
  },

  clearCharacter: () => set({ character: null }),
  clearMovement:  () => set({ movement: null }),
}))

export default useCompileStore
