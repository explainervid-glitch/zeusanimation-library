import { createContext, useContext } from 'react'
import useAssetStore from './useAssetStore'

// Which store a Sidebar/Grid subtree reads its PANEL-LEVEL state from
// (selectedCategory, assets, selectedStyleId, search…). Workspace-level state
// (tree, activePackIndex, scanning) is always read from the main useAssetStore
// directly, since it is shared across panels.
//
// Default = the main/global store, so the left (main) panel needs no provider
// and behaves exactly as before. The secondary panel wraps its subtree in
// <PanelStoreContext.Provider value={useSecondaryStore}> to get independent state.
export const PanelStoreContext = createContext(useAssetStore)

// Reactive: `usePanelStore(s => s.selectedCategory)` or `usePanelStore()` for all.
export const usePanelStore = (selector) => useContext(PanelStoreContext)(selector)

// Imperative access to the store api (getState/setState) for non-reactive calls.
export const usePanelStoreApi = () => useContext(PanelStoreContext)
