import { memo, useId } from 'react'

// ─── PEGTOP LOADER ────────────────────────────────────────────
// Three diamonds falling through the frame, staggered — from
// uiverse.io/andrew-manzyk/fast-vampirebat-53 (MIT).
//
// Two deliberate changes from the original snippet:
//  1. No styled-components (not a dependency here) — the animation lives in
//     assets/index.css as .pegtop-* classes.
//  2. The original repeats the SAME element ids in all three SVGs, which is
//     invalid HTML and would collide between loaders. Gradient/filter/mask ids
//     are scoped per instance with useId() instead.
//
// The shape fills with `currentColor`, which the CSS points at --c-accent, so
// it follows the theme in both light and dark mode.

const SHAPE =
  'M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,' +
  '6.3-23,13-27,27-4,27-13-20.3-9-27-13Z'

// Defined at MODULE scope on purpose. Declaring it inside PegtopLoader makes a
// new component type every render, so React unmounts/remounts these SVGs and
// the CSS animation restarts from frame 0 — with the app's background DB
// polling re-rendering the panel, the loader never completes a loop.
const Diamond = memo(function Diamond({ cls, id }) {
  return (
    <svg className={cls} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g>
        <path d={SHAPE} fill="currentColor" />
        <path d={SHAPE} fill={`url(#${id('g1')})`} />
        <path d={SHAPE} fill="none" stroke="white" opacity="0.3" strokeWidth={3}
          filter={`url(#${id('shine')})`} mask={`url(#${id('mask')})`} />
        <path d={SHAPE} fill={`url(#${id('g2')})`} />
        <path d={SHAPE} fill={`url(#${id('g3')})`} />
        <path d={SHAPE} fill={`url(#${id('g4')})`} />
        <path d={SHAPE} fill={`url(#${id('g5')})`} />
      </g>
    </svg>
  )
}, (a, b) => a.cls === b.cls)   // ids are per-instance and never change

function PegtopLoader({ size = 64, className = '' }) {
  const uid = useId().replace(/:/g, '')          // ':' is invalid in url(#…)
  const id  = (name) => `peg-${uid}-${name}`

  // The keyframes translate the shape from -200px to +100px inside a 100px
  // stage, so the motion spans ~300 stage units. The box has to be that tall
  // (scaled) or the diamonds get clipped at the top of their fall.
  const scale = size / 100
  const box   = { width: size, height: Math.round(300 * scale) }

  return (
    <div className={`pegtop ${className}`} style={box} role="status" aria-label="Loading">
      {/* Shared defs — one copy, referenced by all three diamonds */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id={id('shine')}><feGaussianBlur stdDeviation={3} /></filter>
          <mask id={id('mask')}><path d={SHAPE} fill="white" /></mask>

          <radialGradient id={id('g1')} cx={50} cy={66} fx={50} fy={66} r={30}
            gradientTransform="translate(0 35) scale(1 0.5)" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="black" stopOpacity="0.3" />
            <stop offset="50%"  stopColor="black" stopOpacity="0.1" />
            <stop offset="100%" stopColor="black" stopOpacity={0} />
          </radialGradient>

          <radialGradient id={id('g2')} cx={55} cy={20} fx={55} fy={20} r={30}
            gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="white" stopOpacity="0.3" />
            <stop offset="50%"  stopColor="white" stopOpacity="0.1" />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          <radialGradient id={id('g3')} cx={85} cy={50} fx={85} fy={50} r={30}
            gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="white" stopOpacity="0.3" />
            <stop offset="50%"  stopColor="white" stopOpacity="0.1" />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          <radialGradient id={id('g4')} cx={50} cy={58} fx={50} fy={58} r={60}
            gradientTransform="translate(0 47) scale(1 0.2)" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="white" stopOpacity="0.3" />
            <stop offset="50%"  stopColor="white" stopOpacity="0.1" />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          <linearGradient id={id('g5')} x1={50} y1={90} x2={50} y2={10} gradientUnits="userSpaceOnUse">
            <stop offset="0%"  stopColor="black" stopOpacity="0.2" />
            <stop offset="40%" stopColor="black" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      <div className="pegtop-stage" style={{ '--pegtop-scale': scale }}>
        <Diamond cls="pegtop-1" id={id} />
        <Diamond cls="pegtop-2" id={id} />
        <Diamond cls="pegtop-3" id={id} />
      </div>
    </div>
  )
}

// memo: the panel re-renders on background DB polls; without this the loader
// re-renders needlessly (and any future change here risks restarting the CSS
// animation again).
export default memo(PegtopLoader)
