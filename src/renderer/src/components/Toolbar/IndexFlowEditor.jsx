import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Save, Check, Loader, RotateCcw, Trash2, Workflow, Maximize2, Minimize2, PowerOff, Database,
} from 'lucide-react'
import {
  FLOW_TYPES, typeColor, MODE_ADD, MODE_REPLACE, EMPTY_FLOW,
} from '../../../../shared/indexFlow.js'
import useAssetStore from '../../store/useAssetStore'
import useSettingsStore from '../../store/useSettingsStore'

// ═══════════════════════════════════════════════════════════════
//  INDEX FLOW EDITOR — Blender-style node graph
// ═══════════════════════════════════════════════════════════════
// One node per style, one socket row per asset type. Drag an output socket onto
// another node's input socket of the SAME type to make that style's search read
// from this one — Add (union) or Replace (redirect).
//
// Graph space vs screen space: nodes store graph coordinates; the whole canvas
// is one CSS transform. Anything reading pointer coordinates has to divide by
// zoom, which is what toGraph() is for.

const NODE_W   = 190
const HEADER_H = 32
const ROW_H    = 26
const ROW_GAP  = 4
const PAD      = 8
const NODE_H   = HEADER_H + PAD * 2 + FLOW_TYPES.length * ROW_H + (FLOW_TYPES.length - 1) * ROW_GAP

const socketY = (rowIndex) => HEADER_H + PAD + rowIndex * (ROW_H + ROW_GAP) + ROW_H / 2

// Blender's noodles: horizontal tangents scaled by the gap, so a link doubling
// back on itself still reads as a curve rather than a straight overlap.
function noodle(x1, y1, x2, y2) {
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export default function IndexFlowEditor() {
  const [styles,  setStyles]  = useState([])
  const [flow,    setFlow]    = useState(EMPTY_FLOW)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)
  const [dirty,   setDirty]   = useState(false)

  const [pan,  setPan]  = useState({ x: 24, y: 24 })
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [compiled, setCompiled] = useState(null)   // indexflow.db status
  const loadTree = useAssetStore((s) => s.loadTree)
  const enabled            = useSettingsStore((s) => s.indexFlowEnabled)
  const setIndexFlowEnabled = useSettingsStore((s) => s.setIndexFlowEnabled)

  // One of: null | {kind:'pan'} | {kind:'node', id} | {kind:'link', ...}
  const [drag, setDrag]     = useState(null)
  const [selEdge, setSelEdge] = useState(null)   // index into flow.edges

  const wrapRef = useRef(null)

  // ── Load ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await window.api.getIndexFlow()
        if (!alive) return
        if (!res.success) { setError(res.error); setLoading(false); return }
        setStyles(res.styles || [])
        setFlow(res.flow || EMPTY_FLOW)
        setCompiled(res.compiled || null)
      } catch (e) {
        if (alive) setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Escape leaves fullscreen instead of closing Preferences. Registered in the
  // CAPTURE phase and stopped there, so SettingsModal's own window-level
  // Escape handler never sees it — otherwise one keypress would exit fullscreen
  // AND close the modal, losing unsaved edits. A second Escape then closes
  // Preferences as usual.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFullscreen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fullscreen])

  // Styles with no stored position get laid out in a grid, so a pack that has
  // never been wired still opens as a readable board instead of a pile at 0,0.
  const positions = useMemo(() => {
    const out = {}
    styles.forEach((s, i) => {
      out[s.id] = flow.nodes?.[s.id] ?? {
        x: (i % 3) * (NODE_W + 90),
        y: Math.floor(i / 3) * (NODE_H + 50),
      }
    })
    return out
  }, [styles, flow.nodes])

  const styleById = useMemo(
    () => Object.fromEntries(styles.map((s) => [s.id, s])), [styles])

  const mutate = useCallback((fn) => {
    setFlow((f) => { const next = fn(f); return next })
    setDirty(true)
    setSaved(false)
  }, [])

  // ── Coordinate helpers ──────────────────────────────────────
  const toGraph = useCallback((e) => {
    const r = wrapRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - r.left - pan.x) / zoom,
      y: (e.clientY - r.top  - pan.y) / zoom,
    }
  }, [pan, zoom])

  const socketPos = useCallback((styleId, type, side) => {
    const p   = positions[styleId]
    const row = FLOW_TYPES.findIndex((t) => t.type === type)
    if (!p || row < 0) return { x: 0, y: 0 }
    return { x: p.x + (side === 'out' ? NODE_W : 0), y: p.y + socketY(row) }
  }, [positions])

  // ── Drag machine ────────────────────────────────────────────
  const onPointerMove = useCallback((e) => {
    if (!drag) return
    if (drag.kind === 'pan') {
      setPan({ x: e.clientX - drag.offX, y: e.clientY - drag.offY })
    } else if (drag.kind === 'node') {
      const g = toGraph(e)
      const pos = { x: g.x - drag.offX, y: g.y - drag.offY }
      mutate((f) => ({ ...f, nodes: { ...f.nodes, [drag.id]: pos } }))
    } else if (drag.kind === 'link') {
      setDrag((d) => ({ ...d, cursor: toGraph(e) }))
    }
  }, [drag, toGraph, mutate])

  const onPointerUp = useCallback(() => {
    // A link released over empty canvas just evaporates (Blender does the same).
    setDrag(null)
  }, [])

  useEffect(() => {
    if (!drag) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [drag, onPointerMove, onPointerUp])

  const startLink = (e, styleId, type, side) => {
    e.stopPropagation()
    setSelEdge(null)
    const anchor = side === 'out' ? { from: styleId } : { to: styleId }
    setDrag({ kind: 'link', type, side, ...anchor, cursor: toGraph(e) })
  }

  // Completing a link. Sockets are typed, so only the same type on the opposite
  // side of a different node is a legal drop — everything else is ignored
  // rather than silently creating a nonsense edge.
  const finishLink = (e, styleId, type, side) => {
    e.stopPropagation()
    if (!drag || drag.kind !== 'link') return
    if (drag.type !== type || drag.side === side) return

    const from = side === 'out' ? styleId : drag.from
    const to   = side === 'in'  ? styleId : drag.to
    if (from == null || to == null || from === to) { setDrag(null); return }

    mutate((f) => {
      const rest = f.edges.filter((x) => !(x.from === from && x.to === to && x.type === type))
      return { ...f, edges: [...rest, { from, to, type, mode: MODE_ADD }] }
    })
    setDrag(null)
  }

  const toggleMode = (i) => mutate((f) => ({
    ...f,
    edges: f.edges.map((e, idx) => idx === i
      ? { ...e, mode: e.mode === MODE_ADD ? MODE_REPLACE : MODE_ADD }
      : e),
  }))

  const removeEdge = (i) => {
    mutate((f) => ({ ...f, edges: f.edges.filter((_, idx) => idx !== i) }))
    setSelEdge(null)
  }

  // ── Save ────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const res = await window.api.saveIndexFlow({ ...flow, nodes: positions })
      if (!res.success) { setError(res.error); return }
      setFlow(res.flow)
      setCompiled(res.compiled || null)
      // The tree is merged at read time, so the sidebar keeps showing the old
      // wiring until it reloads. Do it here rather than making the user rescan.
      await loadTree()
      setDirty(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-c-text-3 gap-2 text-xs">
        <Loader size={14} className="animate-spin" /> Loading graph…
      </div>
    )
  }

  if (!styles.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-c-text-3 gap-2 text-xs">
        <Workflow size={20} className="text-c-text-4" />
        No styles in this pack yet — run a rescan first.
      </div>
    )
  }

  const dragPath = drag?.kind === 'link' ? (() => {
    const anchor = drag.side === 'out'
      ? socketPos(drag.from, drag.type, 'out')
      : socketPos(drag.to,   drag.type, 'in')
    return drag.side === 'out'
      ? noodle(anchor.x, anchor.y, drag.cursor.x, drag.cursor.y)
      : noodle(drag.cursor.x, drag.cursor.y, anchor.x, anchor.y)
  })() : null

  const body = (
    <div className={fullscreen ? 'flex flex-col gap-3 h-full min-h-0' : 'space-y-3'}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-shrink-0">
        <div className="space-y-1 min-w-0">
          <label className="text-xs font-semibold text-c-text uppercase tracking-wider block">
            Index Flow
          </label>
          <p className="text-[11px] text-c-text-3 leading-relaxed">
            Drag an output socket onto another style&apos;s input of the same type to share
            libraries at search time. <strong className="text-c-text-2">Add</strong> searches both;{' '}
            <strong className="text-c-text-2">Replace</strong> searches the source instead.
            Saved to <code className="font-mono text-[10px] bg-c-raised px-1 py-0.5 rounded border border-c-border">indexflow.json</code> in the pack.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Edit fullscreen'}
            className="p-1.5 rounded-lg border border-c-border-2 bg-c-raised
              text-c-text-3 hover:bg-c-hover hover:text-c-text transition-colors"
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
              border transition-all disabled:opacity-40 disabled:cursor-not-allowed
              ${saved ? 'bg-c-accent/15 border-c-accent text-c-accent'
                      : 'bg-c-raised border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text'}`}
          >
            {saving ? <Loader size={12} className="animate-spin" />
              : saved ? <Check size={12} /> : <Save size={12} />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-c-error bg-c-error-bg/20 border border-c-error/40 rounded-lg px-3 py-2 flex-shrink-0">
          {error}
        </div>
      )}

      {/* The graph stays fully editable while the feature is off — you just
          need to know nothing you draw is affecting search yet. */}
      {!enabled && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/40
          bg-amber-500/10 px-3 py-2 flex-shrink-0">
          <PowerOff size={13} className="text-amber-500 flex-shrink-0" />
          <p className="text-[11px] text-amber-500/90 flex-1 leading-relaxed">
            Index Flow is <strong>off</strong> — these links are saved but ignored by the sidebar,
            search and RAG.
          </p>
          <button
            onClick={() => setIndexFlowEnabled(true)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold flex-shrink-0
              bg-amber-500/20 border border-amber-500/50 text-amber-500
              hover:bg-amber-500/30 transition-colors"
          >
            Turn on
          </button>
        </div>
      )}

      {enabled && compiled?.stale && (
        <div className="flex items-center gap-2 rounded-lg border border-c-border-2
          bg-c-raised px-3 py-2 flex-shrink-0">
          <Database size={13} className="text-c-text-4 flex-shrink-0" />
          <p className="text-[11px] text-c-text-3 leading-relaxed">
            <code className="font-mono text-[10px]">indexflow.db</code> is out of date with the
            current scan — press Save, or rescan, to recompile it.
          </p>
        </div>
      )}

      {/* ── Canvas ── */}
      <div
        ref={wrapRef}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return
          setSelEdge(null)
          setDrag({ kind: 'pan', offX: e.clientX - pan.x, offY: e.clientY - pan.y })
        }}
        onWheel={(e) => {
          // Zoom toward the cursor, so the point under the pointer stays put.
          const r = wrapRef.current.getBoundingClientRect()
          const next = Math.min(1.6, Math.max(0.35, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
          const cx = e.clientX - r.left, cy = e.clientY - r.top
          setPan((p) => ({
            x: cx - (cx - p.x) * (next / zoom),
            y: cy - (cy - p.y) * (next / zoom),
          }))
          setZoom(next)
        }}
        className={`relative rounded-xl border border-c-border overflow-hidden
          bg-c-base cursor-grab active:cursor-grabbing
          ${fullscreen ? 'flex-1 min-h-0' : 'h-[420px]'}`}
        style={{
          // Faded against the canvas: the dots are a spatial reference, not
          // content, and at full --c-border-2 they competed with the noodles.
          backgroundImage:
            'radial-gradient(color-mix(in srgb, var(--c-border-2) 35%, transparent) 1px, transparent 1px)',
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {/* Noodles — under the nodes so sockets stay clickable */}
          <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" width="1" height="1">
            {flow.edges.map((e, i) => {
              if (!styleById[e.from] || !styleById[e.to]) return null   // style deleted on disk
              const a = socketPos(e.from, e.type, 'out')
              const b = socketPos(e.to,   e.type, 'in')
              const c = typeColor(e.type)
              const on = selEdge === i
              return (
                <g key={`${e.from}-${e.to}-${e.type}`} className="pointer-events-auto">
                  {/* Fat invisible stroke — a 2px curve is nearly impossible to hit */}
                  <path d={noodle(a.x, a.y, b.x, b.y)} stroke="transparent" strokeWidth={14}
                    fill="none" className="cursor-pointer"
                    onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(i) }} />
                  {/* Solid for both modes — the midpoint pill is what says
                      Add vs Replace, so a dash would only add visual noise. */}
                  <path d={noodle(a.x, a.y, b.x, b.y)} stroke={c} fill="none"
                    strokeWidth={on ? 3 : 2}
                    opacity={on ? 1 : 0.75} className="pointer-events-none" />
                </g>
              )
            })}

            {dragPath && (
              <path d={dragPath} stroke={typeColor(drag.type)} strokeWidth={2}
                fill="none" opacity={0.9} />
            )}
          </svg>

          {/* Edge mode pills */}
          {flow.edges.map((e, i) => {
            if (!styleById[e.from] || !styleById[e.to]) return null
            const a = socketPos(e.from, e.type, 'out')
            const b = socketPos(e.to,   e.type, 'in')
            const replace = e.mode === MODE_REPLACE
            return (
              <div
                key={`pill-${e.from}-${e.to}-${e.type}`}
                className="absolute flex items-center gap-1 -translate-x-1/2 -translate-y-1/2"
                style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
                onPointerDown={(ev) => ev.stopPropagation()}
              >
                <button
                  onClick={() => toggleMode(i)}
                  title="Click to switch between Add and Replace"
                  className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border shadow-sm transition-colors
                    ${replace
                      ? 'bg-c-surface border-c-accent text-c-accent'
                      : 'bg-c-surface border-c-border-2 text-c-text-2 hover:text-c-text'}`}
                >
                  {replace ? 'Replace' : 'Add'}
                </button>
                {selEdge === i && (
                  <button
                    onClick={() => removeEdge(i)}
                    title="Delete link"
                    className="p-0.5 rounded bg-c-surface border border-c-border-2 text-c-text-3
                      hover:text-c-error hover:border-c-error transition-colors"
                  >
                    <Trash2 size={9} />
                  </button>
                )}
              </div>
            )
          })}

          {/* Nodes */}
          {styles.map((s) => {
            const p = positions[s.id]
            return (
              <div
                key={s.id}
                className="absolute rounded-lg border border-c-border-2 bg-c-surface shadow-lg select-none"
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {/* Header — the drag handle */}
                <div
                  onPointerDown={(e) => {
                    const g = toGraph(e)
                    setSelEdge(null)
                    setDrag({ kind: 'node', id: s.id, offX: g.x - p.x, offY: g.y - p.y })
                  }}
                  className="h-8 flex items-center px-2.5 rounded-t-lg cursor-move
                    bg-c-raised border-b border-c-border truncate"
                  title={`${s.name} — style_id ${s.id}`}
                >
                  <span className="text-[11px] font-semibold text-c-text truncate">{s.name}</span>
                  <span className="ml-auto text-[9px] font-mono text-c-text-4 flex-shrink-0">{s.id}</span>
                </div>

                {/* Socket rows */}
                <div className="p-2 space-y-1">
                  {FLOW_TYPES.map(({ type, label, color }) => {
                    // A style with no folder of this type has nothing to browse
                    // and no style_type row to search, so linking into it would
                    // do nothing. Dim it rather than let it be wired.
                    const has = s.types.includes(type)
                    const compatible = drag?.kind === 'link' && drag.type === type
                    return (
                      <div
                        key={type}
                        className={`relative flex items-center justify-center rounded border text-[10px]
                          ${has ? 'bg-c-base border-c-border text-c-text-2'
                                : 'bg-c-base/40 border-dashed border-c-border text-c-text-4'}`}
                        style={{ height: ROW_H }}
                        title={has ? label : `${label} — this style has no ${label.toLowerCase()} folder`}
                      >
                        {label}

                        {/* Input (left) */}
                        <Socket side="in" color={color} enabled={has} highlight={compatible && drag.side === 'out'}
                          onDown={(e) => has && startLink(e, s.id, type, 'in')}
                          onUp={(e) => has && finishLink(e, s.id, type, 'in')} />

                        {/* Output (right) */}
                        <Socket side="out" color={color} enabled={has} highlight={compatible && drag.side === 'in'}
                          onDown={(e) => has && startLink(e, s.id, type, 'out')}
                          onUp={(e) => has && finishLink(e, s.id, type, 'out')} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Reset view */}
        <button
          onClick={(e) => { e.stopPropagation(); setPan({ x: 24, y: 24 }); setZoom(1) }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Reset view"
          className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-c-surface/90 border border-c-border
            text-c-text-3 hover:text-c-text transition-colors"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <p className="text-[10px] text-c-text-4 leading-relaxed flex-shrink-0">
        Drag the header to move a node, drag the background to pan, scroll to zoom. Links resolve
        one hop only — if A feeds B and B feeds C, C does not inherit A.
        {fullscreen && <span className="ml-1">Press <kbd className="font-mono">Esc</kbd> to exit fullscreen.</span>}
      </p>
    </div>
  )

  if (!fullscreen) return body

  // Portalled rather than styled in place: the editor sits inside the
  // Preferences modal, whose ancestors are `overflow-hidden` with their own
  // stacking context — a `fixed` child would still be clipped by them. z-[60]
  // clears the modal's z-50.
  //
  // The target is #root, NOT document.body. useSettingsStore puts the
  // `theme-light` / `theme-dark` class on #root, and that class is what defines
  // the --c-* variables; a portal into <body> lands OUTSIDE it and silently
  // falls back to the `:root` block in index.css, which holds the dark palette.
  // That made fullscreen always render dark regardless of the chosen theme.
  // #root sets no transform/filter, so `position: fixed` still resolves against
  // the viewport and escapes its `overflow: hidden`.
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-c-base p-5 flex flex-col">
      {body}
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

// Sockets sit half outside the row so they read as connection points on the
// node's edge, the way Blender draws them.
function Socket({ side, color, enabled, highlight, onDown, onUp }) {
  return (
    <span
      onPointerDown={onDown}
      onPointerUp={onUp}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full border-2 transition-all
        ${side === 'in' ? '-left-[15px]' : '-right-[15px]'}
        ${enabled ? 'cursor-crosshair' : 'opacity-25 cursor-not-allowed'}
        ${highlight ? 'w-3.5 h-3.5 ring-2 ring-offset-0' : 'w-2.5 h-2.5'}`}
      style={{
        background: enabled ? color : 'transparent',
        borderColor: color,
        boxShadow: highlight ? `0 0 0 3px ${color}55` : undefined,
      }}
    />
  )
}
