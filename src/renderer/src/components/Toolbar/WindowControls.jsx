import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

// Custom min / maximize / close buttons for the frameless window.
// Marked no-drag so clicks aren't swallowed by the draggable title bar.
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api?.windowIsMaximized?.().then(setMaximized).catch(() => {})
    const off = window.api?.onWindowMaximizedChanged?.(setMaximized)
    return () => { if (typeof off === 'function') off() }
  }, [])

  const base =
    'flex items-center justify-center w-11 h-12 text-c-text-3 transition-colors'

  return (
    <div
      className="flex items-center h-12 -mr-4 flex-shrink-0"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <button
        onClick={() => window.api?.windowMinimize?.()}
        title="Minimize"
        className={`${base} hover:bg-c-hover hover:text-c-text`}
      >
        <Minus size={15} />
      </button>

      <button
        onClick={() => window.api?.windowToggleMaximize?.()}
        title={maximized ? 'Restore' : 'Maximize'}
        className={`${base} hover:bg-c-hover hover:text-c-text`}
      >
        {maximized ? <Copy size={12} /> : <Square size={13} />}
      </button>

      <button
        onClick={() => window.api?.windowClose?.()}
        title="Close"
        className={`${base} hover:bg-red-600 hover:text-white`}
      >
        <X size={16} />
      </button>
    </div>
  )
}
