import { useEffect, useRef } from 'react'
import Toolbar from './components/Toolbar/Toolbar'
import Sidebar from './components/Sidebar/Sidebar'
import AssetGrid from './components/Grid/AssetGrid'
import AISidebar from './components/AISidebar/AiSidebar'
import useAssetStore from './store/useAssetStore'
import useAISidebarStore from './store/useAISidebarStore'

function ScanOverlay({ logs }) {
  const bottomRef = useRef(null)

  // Auto-scroll ke bawah saat log baru masuk
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-c-surface border border-c-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-c-border">
          <div className="w-4 h-4 border-2 border-c-border border-t-c-accent rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-c-text">Scanning Assets...</p>
            <p className="text-[11px] text-c-text-4 mt-0.5">Building database from asset folder</p>
          </div>
        </div>

        {/* Log area */}
        <div className="h-56 overflow-y-auto px-4 py-3 bg-c-base font-mono">
          {logs.length === 0 ? (
            <p className="text-[11px] text-c-text-4">Initializing...</p>
          ) : (
            logs.map((line, i) => (
              <p key={i} className={`text-[11px] leading-5
                ${line.startsWith('  ⚠') ? 'text-amber-400' :
                  line.startsWith('Selesai') ? 'text-green-400' :
                  line.startsWith('Style') || line.startsWith('  [') ? 'text-c-text-2' :
                  'text-c-text-4'}
              `}>
                {line}
              </p>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-c-border bg-c-raised/40">
          <p className="text-[10px] text-c-text-4">Please wait, do not close the app</p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { switchPack, error, clearError, scanning, scanLogs, startDbPolling, stopDbPolling } = useAssetStore()
  useEffect(() => {
    switchPack(0)
    startDbPolling()
    return () => stopDbPolling()
  }, [])

  return (
    <div className="h-screen w-screen flex flex-col bg-c-base text-c-text overflow-hidden">

      {/* Scan overlay */}
      {scanning && <ScanOverlay logs={scanLogs} />}

      {/* Error toast */}
      {error && (
        <div className="absolute top-14 right-4 z-50 bg-c-error-bg border border-c-error text-c-error
          text-xs px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 max-w-sm">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="text-c-error hover:text-c-text font-bold">✕</button>
        </div>
      )}

      {/* Top Toolbar */}
      <Toolbar />

      {/* Main Layout: Sidebar + Grid + AI Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-c-base">
          <AssetGrid />
        </main>
        <AISidebar />
      </div>

    </div>
  )
}