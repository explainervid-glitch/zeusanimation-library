import { useRef, useEffect } from 'react'
import lottie from 'lottie-web'
import lottieData from '../assets/lottie.json'

// ─── LOTTIE LOADING OVERLAY ───────────────────────────────────
// The ZeusPack mark animating over whatever is loading — same animation the
// splash screen plays, so AI work looks the same everywhere in the app.
//
// Used by AssetEditModal (single asset tagging) and AssetCard (batch tagging).
// Sizing/label are props because the card is far smaller than the modal.
export default function LottieOverlay({
  visible,
  size      = 'w-40 h-40',
  label     = 'Generating Tags...',
  className = 'backdrop-brightness-50 rounded-2xl z-50',
}) {
  const containerRef = useRef(null)
  const animRef      = useRef(null)

  useEffect(() => {
    if (!visible) {
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
      return
    }

    // Delay sedikit untuk memastikan DOM sudah siap
    const timer = setTimeout(() => {
      if (!containerRef.current) return

      try {
        if (!lottieData || !lottieData.v) {
          console.warn('[LottieOverlay] Invalid animation data:', lottieData)
          return
        }

        animRef.current = lottie.loadAnimation({
          container:     containerRef.current,
          renderer:      'svg',
          loop:          true,
          autoplay:      true,
          animationData: lottieData,
        })
      } catch (err) {
        console.error('[LottieOverlay] Error loading animation:', err)
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center ${className}`}>
      <div ref={containerRef} className={size} />
      {label && <p className="text-c-text text-xs mt-4 font-medium">{label}</p>}
    </div>
  )
}
