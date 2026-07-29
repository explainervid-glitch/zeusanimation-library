import { Combine, Sun, Moon } from 'lucide-react'
import useAssetStore from '../store/useAssetStore'
import useSettingsStore from '../store/useSettingsStore'
import useCompileStore from '../store/useCompileStore'

// Persistent status bar: current pack + counts on the left, mode actions on
// the right. (The old "active project" selector lived here and is gone —
// destinations are now chosen per-import.)
export default function BottomBar() {
  const activePackIndex      = useAssetStore((s) => s.activePackIndex)
  const blenderImportEnabled = useSettingsStore((s) => s.blenderImportEnabled)
  const char2dImportEnabled  = useSettingsStore((s) => s.char2dImportEnabled)
  const theme                = useSettingsStore((s) => s.theme)
  const setTheme             = useSettingsStore((s) => s.setTheme)
  const isCompileMode        = useCompileStore((s) => s.isCompileMode)
  const toggleCompileMode    = useCompileStore((s) => s.toggleCompileMode)

  // 3D compile needs the Blender import mode on. 2D (Animate) is available for
  // the whole pack — it works without Direct Character Import, just skipping
  // the copy step. "2D Character" remains an explicit opt-out.
  const canCompile = (activePackIndex === 1 && blenderImportEnabled) ||
    (activePackIndex === 0 && char2dImportEnabled)

  return (
    <footer className="h-12 flex items-center gap-3 px-4 flex-shrink-0
      select-none bg-c-surface border-t border-c-border text-[11px]">

      {/* Left — appearance: icon shows the CURRENT mode, click to switch */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          className="flex items-center justify-center w-7 h-7 rounded-md
            text-c-text-3 hover:text-c-text hover:bg-c-raised transition-colors"
        >
          {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </div>

      {/* Right — mode actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {canCompile && (
          <button
            onClick={toggleCompileMode}
            title={isCompileMode ? 'Exit Compile mode' : 'Compile mode — pick a Character + a Movement'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              border transition-all
              ${isCompileMode
                ? 'bg-c-accent/15 border-c-accent text-c-accent'
                : 'bg-c-raised text-c-text-2 border-c-border-2 hover:bg-c-hover hover:text-c-text'
              }`}
          >
            <Combine size={13} />
            Compile
          </button>
        )}
      </div>
    </footer>
  )
}
