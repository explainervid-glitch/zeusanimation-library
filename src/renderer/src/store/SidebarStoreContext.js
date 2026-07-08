import { createContext, useContext } from 'react'
import useSidebarStore from './useSidebarStore'

// Which sidebar store a Sidebar reads its collapse/width state from.
// Default = the main panel's store, so the left panel needs no provider.
// The secondary panel wraps its subtree in a provider pointing at its own
// store, giving each panel an independent hide/resize state.
export const SidebarStoreContext = createContext(useSidebarStore)

export const usePanelSidebarStore = (selector) => useContext(SidebarStoreContext)(selector)
