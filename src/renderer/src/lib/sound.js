// ─── UI SOUNDS ────────────────────────────────────────────────
// Synthesized via Web Audio — no bundled audio file, works offline, matches
// the app's self-contained style (see the no-remote-deps note in splash.html).

// One shared AudioContext. Browsers cap how many can exist, and creating one
// per play leaks them, so lazy-init and reuse.
let ctx = null

function getCtx() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

// Play a single note through its own gain node, with a short attack/decay
// envelope so it fades instead of clicking at the edges.
function note(context, freq, startAt, duration, peak = 0.18) {
  const osc = context.createOscillator()
  const gain = context.createGain()

  osc.type = 'sine'
  osc.frequency.value = freq

  const end = startAt + duration
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.015) // attack
  gain.gain.exponentialRampToValueAtTime(0.0001, end)      // decay

  osc.connect(gain).connect(context.destination)
  osc.start(startAt)
  osc.stop(end)
}

// A gentle two-note ascending chime (C6 → E6). Signals a finished batch run.
// Best-effort: any failure (no Web Audio, autoplay blocked) is swallowed so a
// missing sound can never break the tagging flow.
export function playChime() {
  try {
    const context = getCtx()
    if (!context) return

    // A run that finishes while the window was backgrounded can leave the
    // context suspended; resume so the chime actually sounds.
    if (context.state === 'suspended') context.resume()

    const t = context.currentTime
    note(context, 1046.5, t, 0.18)         // C6
    note(context, 1318.5, t + 0.12, 0.28)  // E6
  } catch {
    // ignore — a notification sound is never worth throwing over
  }
}
