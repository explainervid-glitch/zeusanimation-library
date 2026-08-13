import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { ensureSql } from './db/index.js'
import { readIndexFlowRaw, isIndexFlowEnabled } from './indexFlow.js'
import { resolveStyleIds, FLOW_TYPES } from '../shared/indexFlow.js'

const DB_FILENAME = 'indexflow.db'

// ═══════════════════════════════════════════════════════════════
//  INDEXFLOW.DB — the compiled graph, kept out of _zeuspack.db
// ═══════════════════════════════════════════════════════════════
// indexflow.json says WHAT is linked (style 2's Background reads style 1's).
// This file says what that resolves to against the current scan: concrete
// style_type ids and the merged category rows.
//
// It is a SEPARATE database on purpose. _zeuspack.db is never touched by this
// feature, so an older build of the app — or any other tool pointed at the pack
// — reads exactly the tree it always did. Turning Index Flow off and deleting
// this file leaves no trace of the feature in the pack.
//
// Written on rescan and whenever the graph is saved. It is a materialized view,
// not the read path: search and the sidebar still resolve live from
// indexflow.json, which costs an in-memory pass over a tree that is already
// loaded and can never go stale. The fingerprint below is what tells you
// whether this file still matches the scan that produced it.

export function indexFlowDbPath(root) {
  return join(root, DB_FILENAME)
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

// Identifies the (scan, graph) pair this compilation came from. If either the
// style_type rows or the edges change, the hash changes and the file is known
// to be stale — style_type ids are AUTOINCREMENT and are reassigned by every
// rescan, so "same edges" alone is not enough to trust it.
function fingerprint(styleTypes, flow) {
  const scan = styleTypes
    .map((st) => `${st.id}:${st.style_id}:${st.type}`)
    .sort()
    .join('|')
  const edges = [...flow.edges]
    .map((e) => `${e.from}>${e.to}:${e.type}:${e.mode}`)
    .sort()
    .join('|')
  return createHash('sha1').update(`${scan}#${edges}`).digest('hex')
}

// ── Build ─────────────────────────────────────────────────────
// Compiles indexflow.json against `sourceDb` (the live _zeuspack.db) and writes
// indexflow.db beside it. Returns a small summary, or null when the feature is
// off or the graph is empty.
export async function buildIndexFlowDb(root, sourceDb) {
  if (!root) return null

  // Disabled: clear the compiled file rather than just skipping. A rescan with
  // the feature off would otherwise leave an orphan from an earlier run sitting
  // in the pack, contradicting the tree the app is actually serving.
  if (!isIndexFlowEnabled()) {
    removeIndexFlowDb(root)
    return null
  }
  if (!sourceDb) return null

  const flow = readIndexFlowRaw(root)
  if (!flow.edges.length) {
    // Nothing wired — an empty compiled file would only be misleading.
    removeIndexFlowDb(root)
    return null
  }

  const styleTypes = queryAll(sourceDb, 'SELECT id, style_id, type FROM style_types')
  const categories = queryAll(sourceDb, `
    SELECT c.id, c.name, c.style_type_id, COUNT(a.id) as asset_count
    FROM categories c
    LEFT JOIN assets a ON a.category_id = c.id
    GROUP BY c.id, c.name, c.style_type_id
  `)

  const byStyleType = new Map()            // "styleId:type" → style_type_id
  for (const st of styleTypes) byStyleType.set(`${st.style_id}:${st.type}`, st.id)

  const catsByStyleType = new Map()        // style_type_id → category rows
  for (const c of categories) {
    if (!catsByStyleType.has(c.style_type_id)) catsByStyleType.set(c.style_type_id, [])
    catsByStyleType.get(c.style_type_id).push(c)
  }

  const SQL = await ensureSql()
  const out = new SQL.Database()
  out.run(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE resolved_style_type (
      target_style_type_id INTEGER NOT NULL,
      source_style_type_id INTEGER NOT NULL,
      source_style_id      INTEGER NOT NULL,
      borrowed             INTEGER NOT NULL
    );
    CREATE TABLE resolved_category (
      target_style_type_id INTEGER NOT NULL,
      name                 TEXT    NOT NULL,
      category_id          INTEGER NOT NULL,
      primary_category_id  INTEGER NOT NULL,
      asset_count          INTEGER NOT NULL,
      borrowed             INTEGER NOT NULL
    );
    CREATE INDEX idx_rst_target ON resolved_style_type(target_style_type_id);
    CREATE INDEX idx_rc_target  ON resolved_category(target_style_type_id);
  `)

  let links = 0
  let rows  = 0

  for (const st of styleTypes) {
    const sourceIds = resolveStyleIds(flow, st.style_id, st.type)
    const untouched = sourceIds.length === 1 && sourceIds[0] === st.style_id
    if (untouched) continue                // only compile what the graph changes

    // resolveStyleIds puts the target's own id first for ADD and omits it for
    // REPLACE, so iterating in order lets the own row claim primary naturally.
    const merged = new Map()               // category name → row

    for (const sid of sourceIds) {
      const srcStyleTypeId = byStyleType.get(`${sid}:${st.type}`)
      if (srcStyleTypeId == null) continue  // linked style has no folder of this type

      out.run(
        `INSERT INTO resolved_style_type
           (target_style_type_id, source_style_type_id, source_style_id, borrowed)
         VALUES (?, ?, ?, ?)`,
        [st.id, srcStyleTypeId, sid, sid === st.style_id ? 0 : 1]
      )
      links++

      for (const c of catsByStyleType.get(srcStyleTypeId) || []) {
        const cur = merged.get(c.name)
        if (!cur) {
          merged.set(c.name, {
            name: c.name, ids: [c.id], primary: c.id,
            count: c.asset_count, borrowed: sid === st.style_id ? 0 : 1,
          })
        } else {
          cur.ids.push(c.id)
          cur.count += c.asset_count
          if (sid === st.style_id) { cur.primary = c.id; cur.borrowed = 0 }
        }
      }
    }

    for (const m of merged.values()) {
      for (const id of m.ids) {
        out.run(
          `INSERT INTO resolved_category
             (target_style_type_id, name, category_id, primary_category_id, asset_count, borrowed)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [st.id, m.name, id, m.primary, m.count, m.borrowed]
        )
        rows++
      }
    }
  }

  const meta = {
    version:     '1',
    fingerprint: fingerprint(styleTypes, flow),
    built_at:    new Date().toISOString(),
    edges:       String(flow.edges.length),
    note:        'Compiled from indexflow.json. Materialized view — _zeuspack.db is not modified.',
  }
  for (const [k, v] of Object.entries(meta)) {
    out.run('INSERT INTO meta (key, value) VALUES (?, ?)', [k, v])
  }

  writeFileSync(indexFlowDbPath(root), Buffer.from(out.export()))
  out.close()

  console.log(`[IndexFlow] ${DB_FILENAME} built — ${links} link, ${rows} kategori row`)
  return { links, rows, edges: flow.edges.length, fingerprint: meta.fingerprint }
}

export function removeIndexFlowDb(root) {
  if (!root) return false
  const path = indexFlowDbPath(root)
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    console.log(`[IndexFlow] ${DB_FILENAME} removed`)
    return true
  } catch (e) {
    console.warn(`[IndexFlow] Gagal hapus ${DB_FILENAME}:`, e.message)
    return false
  }
}

// Is the compiled file still in step with the current scan + graph? Surfaced in
// the editor so a stale file is visible rather than quietly wrong.
export async function indexFlowDbStatus(root, sourceDb) {
  const path = indexFlowDbPath(root)
  if (!existsSync(path)) return { exists: false }

  try {
    const { readFileSync } = await import('fs')
    const SQL = await ensureSql()
    const db  = new SQL.Database(readFileSync(path))
    const meta = Object.fromEntries(
      queryAll(db, 'SELECT key, value FROM meta').map((r) => [r.key, r.value]))
    db.close()

    if (!sourceDb) return { exists: true, ...meta }

    const styleTypes = queryAll(sourceDb, 'SELECT id, style_id, type FROM style_types')
    const current    = fingerprint(styleTypes, readIndexFlowRaw(root))
    return { exists: true, ...meta, stale: meta.fingerprint !== current }
  } catch (e) {
    return { exists: true, error: e.message }
  }
}

// Types the graph can reference — handy for anything inspecting the file.
export const COMPILED_TYPES = FLOW_TYPES.map((t) => t.type)
