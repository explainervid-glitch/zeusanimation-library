import { useEffect, useState } from 'react'
import { Palette, X } from 'lucide-react'
import useSettingsStore from '../store/useSettingsStore'

// Non-blocking onboarding toast in the bottom-right corner. Tells the user
// which theme is active and where to change it. Dismissed permanently via the
// persisted `themeIntroSeen` flag (X or the button both dismiss).
export default function ThemeIntroModal() {
  const themeIntroSeen    = useSettingsStore((s) => s.themeIntroSeen)
  const dismissThemeIntro = useSettingsStore((s) => s.dismissThemeIntro)
  const theme             = useSettingsStore((s) => s.theme)

  const [visible, setVisible] = useState(false)

  // Slide in shortly after load so it reads as a notification, not a blocker.
  useEffect(() => {
    if (themeIntroSeen) return
    const t = setTimeout(() => setVisible(true), 400)
    return () => clearTimeout(t)
  }, [themeIntroSeen])

  if (themeIntroSeen) return null

  const themeLabel = theme === 'light' ? 'Light' : 'Dark'

  return (
    <div
      className={`fixed bottom-4 right-4 z-[60] w-72 transition-all duration-300 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
    >
      <div className="bg-c-surface border border-c-border rounded-xl shadow-2xl overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-c-accent/10 flex items-center justify-center flex-shrink-0">
              <Palette size={16} className="text-c-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-c-text">{themeLabel} mode is on</p>
              <p className="text-xs text-c-text-2 leading-relaxed mt-1">
                You can switch themes anytime from{' '}
                <span className="font-medium text-c-text">Settings → Theme</span>.
              </p>
            </div>
            <button
              onClick={dismissThemeIntro}
              title="Dismiss"
              className="flex-shrink-0 text-c-text-4 hover:text-c-text transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <button
            onClick={dismissThemeIntro}
            className="mt-3 w-full px-3 py-2 rounded-lg text-xs font-semibold
              bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-colors"
          >
            OK &amp; don&apos;t show me again
          </button>
        </div>
      </div>
    </div>
  )
}
