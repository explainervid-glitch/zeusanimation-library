import { useRef, useEffect } from 'react'
import { PanelStoreContext } from '../store/PanelStoreContext'
import { SidebarStoreContext } from '../store/SidebarStoreContext'
import useSecondaryStore from '../store/useSecondaryStore'
import { useSecondarySidebarStore } from '../store/useSidebarStore'
import useAssetStore from '../store/useAssetStore'
import useLayoutStore from '../store/useLayoutStore'
import Sidebar from './Sidebar/Sidebar'
import AssetGrid from './Grid/AssetGrid'

// Right-hand browse panel. Reuses Sidebar + AssetGrid but points them at
// useSecondaryStore (pane state) and useSecondarySidebarStore (collapse/width)
// via context, so it has its own style/category selection AND its own sidebar
// hide/resize state while sharing the same pack as the main panel. View-only.
export default function Panel() {
  const activePackIndex   = useAssetStore((s) => s.activePackIndex)
  const mainSelectedStyle = useAssetStore((s) => s.selectedStyleId)
  const { splitRatio, setSplitRatio } = useLayoutStore()

  const panelRef    = useRef(null)
  const draggingRef = useRef(false)
  const prevPackRef = useRef(activePackIndex)

  // Reset only when the pack ACTUALLY changes (old selection no longer matches
  // the tree). Skips the initial mount, so closing + reopening split view keeps
  // whatever the panel was browsing.
  useEffect(() => {
    if (prevPackRef.current !== activePackIndex) {
      prevPackRef.current = activePackIndex
      useSecondaryStore.getState().reset()
    }
  }, [activePackIndex])

  // On first open, mirror the main panel's current style so the same set of
  // categories is visible. (Sidebar still defaults to tree[0] if this is null.)
  useEffect(() => {
    const s = useSecondaryStore.getState()
    if (s.selectedStyleId == null && mainSelectedStyle != null) {
      s.selectStyle(mainSelectedStyle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Divider drag → adjust secondary panel width fraction.
  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current || !panelRef.current) return
      const parent = panelRef.current.parentElement.getBoundingClientRect()
      if (parent.width <= 0) return
      setSplitRatio((parent.right - e.clientX) / parent.width)
    }
    const onUp = () => { draggingRef.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [setSplitRatio])

  return (
    <>
      {/* Drag handle between the two panels */}
      <div
        onMouseDown={(e) => { if (e.button === 0) { draggingRef.current = true; e.preventDefault() } }}
        className="w-1 flex-shrink-0 cursor-col-resize bg-c-border hover:bg-c-accent/50 transition-colors z-10"
        title="Drag to resize"
      />

      {/* Secondary panel — its own Sidebar + Grid bound to secondary stores */}
      <div
        ref={panelRef}
        className="flex min-w-0 overflow-hidden border-l border-c-border"
        style={{ width: `${splitRatio * 100}%` }}
      >
        <PanelStoreContext.Provider value={useSecondaryStore}>
          <SidebarStoreContext.Provider value={useSecondarySidebarStore}>
            <Sidebar />
            <main className="flex-1 overflow-hidden bg-c-base">
              <AssetGrid enableBatch={false} />
            </main>
          </SidebarStoreContext.Provider>
        </PanelStoreContext.Provider>
      </div>
    </>
  )
}
