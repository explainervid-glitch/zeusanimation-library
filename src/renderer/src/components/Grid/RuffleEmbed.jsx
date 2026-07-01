import { useRef, useEffect, useState } from 'react'

// ── Ruffle config — set once globally before any player is created ──
// publicPath tells ruffle.js where to find its .wasm chunk.
// Since Ruffle is self-hosted at /ruffle (see index.html script tag),
// the wasm lives alongside ruffle.js at the same path.
if (typeof window !== 'undefined') {
  window.RufflePlayer = window.RufflePlayer || {}
  window.RufflePlayer.config = {
    publicPath: './ruffle/',
    autoplay:   'on',
    loop:       true,
    menu:       false,        // hide Ruffle's right-click context menu
    letterbox:  'off',
    backgroundColor: null,    // transparent — let our own bg show through
    splashScreen: false,      // skip Ruffle's loading splash, we show our own
    // Suppress Ruffle's built-in warning overlays (hardware acceleration,
    // unsupported content, etc). These are designed for end-user-facing
    // Flash content on the open web — noisy and out of place on small
    // grid card previews. Real playback failures still surface via
    // the player's onerror, which RuffleEmbed already handles.
    warnOnUnsupportedContent: false,
    showSwfDownload:          false,
    ...((window.RufflePlayer && window.RufflePlayer.config) || {}),
  }
}

/**
 * RuffleEmbed — mounts a live Ruffle (Flash) player for a single .swf file.
 *
 * Deliberately imperative (not declarative JSX <embed>) because Ruffle's
 * web component needs `.load()` called on a real DOM node it controls,
 * and we want full control over mount/unmount timing for perf reasons
 * (grid cards should NOT keep a live player running when off-screen).
 *
 * Usage:
 *   <RuffleEmbed src={fileUrl} onError={() => ...} />
 */
export default function RuffleEmbed({ src, className = '', onError }) {
  const containerRef = useRef(null)
  const playerRef     = useRef(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [ready, setReady]           = useState(false)

  useEffect(() => {
    if (!src) return
    setLoadFailed(false)
    setReady(false)

    let cancelled = false

    const mount = async () => {
      if (!window.RufflePlayer) {
        // ruffle.js hasn't loaded yet (shouldn't happen if index.html script
        // tag is present, but guard anyway)
        setLoadFailed(true)
        onError?.()
        return
      }

      try {
        const ruffle = window.RufflePlayer.newest()
        const player = ruffle.createPlayer()
        player.style.width    = '100%'
        player.style.height   = '100%'
        player.style.position = 'absolute'
        player.style.inset    = '0'

        if (cancelled) return
        containerRef.current?.appendChild(player)
        playerRef.current = player

        await player.load({ url: src, autoplay: 'on', loop: true })
        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true)
          onError?.()
        }
      }
    }

    mount()

    return () => {
      cancelled = true
      // Ruffle players must be explicitly destroyed or they leak WASM memory
      try {
        playerRef.current?.remove?.()
      } catch {
        // ignore — player may already be gone
      }
      playerRef.current = null
    }
  }, [src])

  if (loadFailed) return null // parent falls back to placeholder

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ opacity: ready ? 1 : 0, transition: 'opacity 150ms' }}
    />
  )
}