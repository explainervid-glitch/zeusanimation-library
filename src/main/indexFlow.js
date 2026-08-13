import { existsSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { normalizeFlow, resolveStyleIds, resolveScope, EMPTY_FLOW } from '../shared/indexFlow.js'
import { readSettings } from './settings.js'


const FILENAME = 'indexflow.json'

// ═══════════════════════════════════════════════════════════════
//  INDEXFLOW.JSON — pack-level, beside stylenames.json
// ═══════════════════════════════════════════════════════════════
// This CANNOT live in _zeuspack.db: scanAssets() calls clearAll(), and
// style_types.id is AUTOINCREMENT, so both the rows and their ids are thrown
// away on every rescan. Edges are keyed by style_id (the folder suffix — stable
// by construction) and stored as a sidecar file, exactly like stylenames.json,
// so a rescan can't destroy the team's wiring.

// Compared against false, not true: the default is ON, so only an explicit
// opt-out written to settings.json disables the feature.
export function isIndexFlowEnabled() {
  return readSettings().indexFlowEnabled !== false
}

// The graph exactly as stored, regardless of the feature toggle — for the
// editor, which has to show and save the wiring even while the feature is off.
export function readIndexFlowRaw(root) {
  if (!root) return { ...EMPTY_FLOW }
  const path = join(root, FILENAME)
  if (!existsSync(path)) return { ...EMPTY_FLOW }
  try {
    return normalizeFlow(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (e) {
    console.warn(`[IndexFlow] Gagal parse ${FILENAME}:`, e.message)
    return { ...EMPTY_FLOW }
  }
}

// The graph as the SEARCH and TREE paths see it. This is the single gate for
// the whole feature: with the toggle off it hands back an empty graph, and
// every consumer below already early-returns on "no edges" — so the tree,
// keyword search and RAG all fall back to the original per-style behaviour
// with no other branching anywhere.
export function readIndexFlow(root) {
  if (!isIndexFlowEnabled()) return { ...EMPTY_FLOW }
  return readIndexFlowRaw(root)
}

// Mtime of the sidecar, for the same remote-change polling that watches
// _zeuspack.db. The graph lives OUTSIDE the database by design, which means
// wiring it on one PC leaves the DB's mtime untouched — without this, every
// other teammate's app would keep serving its cached tree until restart.
export function indexFlowMtime(root) {
  if (!root) return 0
  const path = join(root, FILENAME)
  try {
    return existsSync(path) ? statSync(path).mtimeMs : 0
  } catch {
    return 0
  }
}

export function writeIndexFlow(root, flow) {
  if (!root) throw new Error('[writeIndexFlow] root tidak boleh kosong')
  const clean = normalizeFlow(flow)
  writeFileSync(join(root, FILENAME), JSON.stringify(clean, null, 2), 'utf-8')
  console.log(`[IndexFlow] ${FILENAME} updated: ${clean.edges.length} edge`)
  return clean
}

// ── DB-side resolution ────────────────────────────────────────
// The editor speaks style_id; SQLite search speaks style_type_id. These bridge
// the two, re-reading the sidecar each call so an edit by a teammate on the
// shared drive takes effect without an app restart.

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

// Expand one style_type_id into every style_type_id its search should cover.
// Falls back to [styleTypeId] whenever anything is missing, so a broken or
// absent indexflow.json degrades to plain per-style search rather than to
// zero results.
export function expandStyleTypeIds(db, root, styleTypeId) {
  const self = queryAll(db,
    'SELECT style_id, type FROM style_types WHERE id = ? LIMIT 1', [styleTypeId])[0]
  if (!self) return [styleTypeId]

  const flow     = readIndexFlow(root)
  const styleIds = resolveStyleIds(flow, self.style_id, self.type)

  // Unchanged by the graph — skip the second query.
  if (styleIds.length === 1 && styleIds[0] === self.style_id) return [styleTypeId]
  if (!styleIds.length) return []

  const placeholders = styleIds.map(() => '?').join(',')
  const rows = queryAll(db,
    `SELECT id FROM style_types WHERE type = ? AND style_id IN (${placeholders})`,
    [self.type, ...styleIds])

  // A REPLACE pointing at a style that no longer exists on disk would leave an
  // empty set and silently return nothing — fall back to the style's own assets.
  return rows.length ? rows.map((r) => r.id) : [styleTypeId]
}

// Scope for a whole-style RAG query: [{ style_id, asset_type }, ...].
export function ragScopeForStyle(root, styleId) {
  return resolveScope(readIndexFlow(root), styleId)
}

// ── Tree merge ────────────────────────────────────────────────
// Rewrites getFullTree() output so the sidebar shows what search actually
// covers. Categories are merged BY NAME — "Forest" in style 1 and "Forest" in
// style 2 are one row, not two — and each row carries every category id it
// stands for.
//
// Shape added to each category:
//   ids       — every category_id this row covers (always ≥ 1)
//   borrowed  — true when this row exists only because of a link
//
// `id` stays a single real category id and is deliberately biased to the
// style's OWN row when it has one: add-category / rename / delete all act on
// `id`, and they must hit this style's row, never the lender's.
export function applyFlowToTree(root, tree) {
  const flow = readIndexFlow(root)
  if (!flow.edges.length) return tree

  const index = new Map()   // "styleId:type" → type node
  for (const s of tree) for (const t of s.types || []) index.set(`${s.id}:${t.type}`, t)

  return tree.map((style) => ({
    ...style,
    types: (style.types || []).map((t) => {
      const sourceIds = resolveStyleIds(flow, style.id, t.type)
      const isSelf = sourceIds.length === 1 && sourceIds[0] === style.id
      if (isSelf) return t

      // resolveStyleIds puts the style's own id first for ADD, and omits it
      // entirely for REPLACE — so iterating in order means the own row is seen
      // before any lender and wins the `id` slot naturally.
      const merged = new Map()
      for (const sid of sourceIds) {
        const src = index.get(`${sid}:${t.type}`)
        if (!src) continue
        for (const c of src.categories || []) {
          const cur = merged.get(c.name)
          if (!cur) {
            merged.set(c.name, {
              ...c,
              ids:      [c.id],
              borrowed: sid !== style.id,
            })
          } else {
            cur.ids.push(c.id)
            cur.asset_count = (cur.asset_count || 0) + (c.asset_count || 0)
            if (sid === style.id) { cur.id = c.id; cur.borrowed = false }
          }
        }
      }

      // A REPLACE aimed at a style that no longer exists on disk would empty
      // the type out. Keep the style's own categories rather than show nothing.
      if (!merged.size) return t

      return {
        ...t,
        categories:    [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)),
        borrowed_from: sourceIds.filter((id) => id !== style.id),
      }
    }),
  }))
}
