// ═══════════════════════════════════════════════════════════════
//  INDEX FLOW — shared schema
// ═══════════════════════════════════════════════════════════════
// Styles that look identical often share their Background / Inspiration
// libraries. Rather than duplicating files on disk, a style can borrow another
// style's assets *at search time* via a node graph the user draws in Settings.
//
// An edge always runs source-type ──▶ target-type of the SAME type (Movement
// only ever feeds Movement), which is what makes the sockets safe to type-check
// in the editor.
//
//   ADD     — target searches its own assets AND the source's.
//   REPLACE — target searches the source's assets INSTEAD of its own.
//
// Imported by BOTH main and renderer, same as PathConfig.js.

// DB `style_types.type` values, in the order the editor stacks its sockets.
// The DB calls Movement "animation" (see scanner FOLDER_TYPE_MAP) — the UI
// label and the storage key are deliberately kept apart.
export const FLOW_TYPES = [
  { type: 'animation',   label: 'Movement',    color: '#f59e0b' },
  { type: 'background',  label: 'Background',  color: '#38bdf8' },
  { type: 'character',   label: 'Character',   color: '#34d399' },
  { type: 'inspiration', label: 'Inspiration', color: '#c084fc' },
]

export const FLOW_TYPE_KEYS = FLOW_TYPES.map((t) => t.type)

export function typeLabel(type) {
  return FLOW_TYPES.find((t) => t.type === type)?.label ?? type
}

export function typeColor(type) {
  return FLOW_TYPES.find((t) => t.type === type)?.color ?? '#a1a1aa'
}

export const MODE_ADD     = 'add'
export const MODE_REPLACE = 'replace'

export const EMPTY_FLOW = { version: 1, edges: [], nodes: {} }

// ── Validation ────────────────────────────────────────────────
// indexflow.json is hand-editable and lives on a shared drive, so anything
// read back gets normalised rather than trusted.
export function normalizeFlow(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_FLOW }

  const seen  = new Set()
  const edges = []

  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    const from = Number(e?.from)
    const to   = Number(e?.to)
    const type = String(e?.type || '')
    const mode = e?.mode === MODE_REPLACE ? MODE_REPLACE : MODE_ADD

    if (!Number.isInteger(from) || !Number.isInteger(to)) continue
    if (from === to) continue                       // a style borrowing from itself is a no-op
    if (!FLOW_TYPE_KEYS.includes(type)) continue

    // One edge per (from → to, type); a later duplicate wins.
    const key = `${from}>${to}:${type}`
    if (seen.has(key)) {
      edges[edges.findIndex((x) => `${x.from}>${x.to}:${x.type}` === key)] = { from, to, type, mode }
      continue
    }
    seen.add(key)
    edges.push({ from, to, type, mode })
  }

  const nodes = {}
  for (const [id, pos] of Object.entries(raw.nodes || {})) {
    const n = Number(id)
    if (!Number.isInteger(n)) continue
    nodes[n] = { x: Number(pos?.x) || 0, y: Number(pos?.y) || 0 }
  }

  return { version: 1, edges, nodes }
}

// ── Resolution ────────────────────────────────────────────────
// Which styles' assets should a search of (styleId, type) actually cover?
//
// Deliberately ONE HOP. If A ▶ B and B ▶ C, then C does NOT inherit A. Chasing
// the graph transitively would mean cycle guards, depth limits, and results
// nobody can explain by looking at the editor — the picture on screen would
// stop matching what search does. One hop keeps "what you drew is what you get".
//
// Returns an array of style_ids, always at least one entry unless every
// incoming edge is a REPLACE (in which case the style's own assets drop out).
export function resolveStyleIds(flow, styleId, type) {
  const incoming = (flow?.edges || []).filter((e) => e.to === styleId && e.type === type)
  if (!incoming.length) return [styleId]

  const replaces = incoming.filter((e) => e.mode === MODE_REPLACE).map((e) => e.from)
  const adds     = incoming.filter((e) => e.mode === MODE_ADD).map((e) => e.from)

  // A REPLACE evicts the style's own assets. Any ADD edges still union in on
  // top of it, so "replace with 1, also add 5" is expressible.
  const base = replaces.length ? [] : [styleId]
  return [...new Set([...base, ...replaces, ...adds])]
}

// Full search scope for a style across every type — the shape the RAG server
// takes as its `scope` filter.
export function resolveScope(flow, styleId) {
  const scope = []
  for (const { type } of FLOW_TYPES) {
    for (const sid of resolveStyleIds(flow, styleId, type)) {
      scope.push({ style_id: sid, asset_type: type })
    }
  }
  return scope
}

// Once the tree merges borrowed libraries, a single sidebar row can stand for
// several category ids (same name, different styles). Always send the whole set
// when loading assets — passing `.id` alone would silently show only the
// style's own half of a merged category.
export function categoryScope(category) {
  return category?.ids?.length ? category.ids : (category?.id ?? null)
}

// True when this style borrows anything at all — lets the UI badge it.
export function styleHasIncoming(flow, styleId) {
  return (flow?.edges || []).some((e) => e.to === styleId)
}
