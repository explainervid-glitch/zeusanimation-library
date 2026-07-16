import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs'
import initSqlJs from 'sql.js'

const DB_FILENAME = '_zeuspack.db'

let SQL    = null
let db     = null
let dbPath = null

// ── sql.js WASM ───────────────────────────────────────────────
async function ensureSql() {
  if (SQL) return SQL
  const wasmProd = join(process.resourcesPath, 'sql-wasm.wasm')
  const wasmDev  = join(process.cwd(), 'resources', 'sql-wasm.wasm')
  SQL = await initSqlJs({ locateFile: () => existsSync(wasmProd) ? wasmProd : wasmDev })
  return SQL
}

// ── Path DB di dalam folder aset ──────────────────────────────
export function getDbPathForAsset(assetPath) {
  return join(assetPath, DB_FILENAME)
}

// ── Load DB dari folder aset ──────────────────────────────────
async function loadDb(assetPath) {
  await ensureSql()

  if (!assetPath || !existsSync(assetPath)) {
    throw new Error(`Asset path not found: ${assetPath}`)
  }

  const path = getDbPathForAsset(assetPath)

  if (existsSync(path)) {
    db = new SQL.Database(readFileSync(path))
    console.log(`[DB] Loaded: ${path}`)
  } else {
    db = new SQL.Database()
    console.log(`[DB] New DB: ${path}`)
  }

  db.run('PRAGMA foreign_keys = ON;')
  initSchema()
  dbPath = path
  saveDb()
  return db
}

// ── PUBLIC API ────────────────────────────────────────────────
export async function getDb(assetPath) {
  if (db && assetPath && dbPath === getDbPathForAsset(assetPath)) return db
  if (assetPath) return loadDb(assetPath)
  if (db) return db
  throw new Error('getDb: assetPath required on first init')
}

// Switch pack — TIDAK scan, hanya buka DB berbeda
export async function switchDb(assetPath) {
  const target = getDbPathForAsset(assetPath)
  if (dbPath === target && db) return db
  if (db) saveDb()
  return loadDb(assetPath)
}

// Reinit — hapus data lama, untuk rescan
export async function reinitDb(assetPath) {
  if (db) saveDb()
  return loadDb(assetPath)
}

export function saveDb() {
  if (!db || !dbPath) return
  writeFileSync(dbPath, Buffer.from(db.export()))
}

// Mtime file DB di disk — untuk deteksi perubahan dari PC lain
export function getDbMtime() {
  if (!dbPath || !existsSync(dbPath)) return 0
  try { return statSync(dbPath).mtimeMs } catch { return 0 }
}

// Reload DB dari disk tanpa reinit schema — dipanggil saat PC lain update
export function reloadFromDisk() {
  if (!dbPath || !existsSync(dbPath)) return false
  try {
    if (db) db.close()
    db = new SQL.Database(readFileSync(dbPath))
    db.run('PRAGMA foreign_keys = ON;')
    initSchema()
    console.log(`[DB] Reloaded from disk (remote update detected)`)
    return true
  } catch (err) {
    console.error('[DB] reloadFromDisk error:', err.message)
    return false
  }
}

// ── Schema ────────────────────────────────────────────────────
function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS styles (
      id           INTEGER PRIMARY KEY,
      display_name TEXT DEFAULT NULL,
      description  TEXT DEFAULT NULL,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS style_types (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      style_id     INTEGER NOT NULL REFERENCES styles(id),
      type         TEXT NOT NULL,
      folder_path  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      style_type_id INTEGER NOT NULL REFERENCES style_types(id),
      name          TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id    INTEGER NOT NULL REFERENCES categories(id),
      name           TEXT NOT NULL,
      detail         TEXT DEFAULT NULL,
      raw_path       TEXT DEFAULT NULL,
      mp4_path       TEXT DEFAULT NULL,
      json_path      TEXT DEFAULT NULL,
      rag_json_path  TEXT DEFAULT NULL,
      thumbnail_path TEXT DEFAULT NULL,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_assets_category    ON assets(category_id);
    CREATE INDEX IF NOT EXISTS idx_category_styletype ON categories(style_type_id);
    CREATE INDEX IF NOT EXISTS idx_styletype_style    ON style_types(style_id);
  `)

  // ── Search table (pengganti FTS5 — sql.js tidak support FTS5) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS assets_search (
      asset_id      INTEGER NOT NULL,
      style_type_id INTEGER NOT NULL,
      search_text   TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_search_asset     ON assets_search(asset_id);
    CREATE INDEX IF NOT EXISTS idx_search_styletype ON assets_search(style_type_id);
  `)
}

// ── Helpers ───────────────────────────────────────────────────
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null
}

function run(sql, params = []) {
  db.run(sql, params)
  return queryOne('SELECT last_insert_rowid() as id')?.id
}

// ── Write ─────────────────────────────────────────────────────
export function clearAll() {
  db.run('DELETE FROM assets_search;')
  db.run('DELETE FROM assets;')
  db.run('DELETE FROM categories;')
  db.run('DELETE FROM style_types;')
  db.run('DELETE FROM styles;')
}

// ── Search table helpers ──────────────────────────────────────
function arrToText(val) {
  if (!val) return ''
  if (Array.isArray(val)) return val.filter(Boolean).join(' ')
  return String(val)
}

export function insertAssetFts(assetId, styleTypeId, meta = {}) {
  const m = meta.metadata      || {}
  const d = meta.description   || {}
  const s = meta.search_context || {}

  const parts = [
    meta.FileName, meta.Detail, meta.Category, d.full,
    arrToText(s.keywords), s.scene_prompt,
    m.mood, m.lighting, m.time_of_day,
    arrToText(m.roles), arrToText(m.props),
    m.vibe, m.gender, m.age,
  ]

  const searchText = parts.filter(Boolean).join(' ').toLowerCase()

  run(
    'INSERT INTO assets_search (asset_id, style_type_id, search_text) VALUES (?, ?, ?)',
    [assetId, styleTypeId, searchText]
  )
}

// Delete + re-insert — dipanggil saat edit asset
export function updateAssetFts(assetId, styleTypeId, meta = {}) {
  db.run('DELETE FROM assets_search WHERE asset_id = ?', [assetId])
  insertAssetFts(assetId, styleTypeId, meta)
}

export function searchAssetsFts(styleTypeId, query, limit = 200) {
  // Split query ke term-term, semua term harus match (AND)
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  // Build WHERE clause: satu LIKE per term
  const conditions = terms.map(() => "LOWER(s.search_text) LIKE ?").join(' AND ')
  const params     = [styleTypeId, ...terms.map(t => `%${t}%`), limit]

  // Exclude '⚠ Uncategorized' — junk assets shouldn't surface in search
  return queryAll(`
    SELECT a.*
    FROM assets_search s
    JOIN assets a      ON a.id = s.asset_id
    JOIN categories c  ON c.id = a.category_id
    WHERE s.style_type_id = ? AND c.name != '⚠ Uncategorized' AND ${conditions}
    ORDER BY a.name
    LIMIT ?
  `, params)
}

export function insertStyle(id, displayName = null, description = null) {
  db.run('INSERT OR REPLACE INTO styles (id, display_name, description) VALUES (?, ?, ?)',
    [id, displayName, description])
  return id
}

export function insertStyleType(styleId, type, folderPath) {
  return run('INSERT INTO style_types (style_id, type, folder_path) VALUES (?, ?, ?)',
    [styleId, type, folderPath])
}

export function insertCategory(styleTypeId, name) {
  return run('INSERT INTO categories (style_type_id, name) VALUES (?, ?)', [styleTypeId, name])
}

export function insertAsset({ categoryId, name, detail, rawPath, mp4Path, thumbnailPath, jsonPath, ragJsonPath }) {
  return run(
    `INSERT INTO assets (category_id, name, detail, raw_path, mp4_path, thumbnail_path, json_path, rag_json_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, name, detail||null, rawPath||null, mp4Path||null, thumbnailPath||null, jsonPath||null, ragJsonPath||null]
  )
}

// ── Read ──────────────────────────────────────────────────────
export function getFullTree() {
  const styles = queryAll(
    `SELECT id, COALESCE(display_name, 'Style ' || id) as name, description
     FROM styles ORDER BY id`
  )
  return styles.map(style => {
    const types = queryAll(
      'SELECT id, type, folder_path FROM style_types WHERE style_id = ? ORDER BY type',
      [style.id]
    )
    return {
      ...style,
      types: types.map(t => ({
        ...t,
        categories: queryAll(`
          SELECT c.id, c.name, COUNT(a.id) as asset_count
          FROM categories c
          LEFT JOIN assets a ON a.category_id = c.id
          WHERE c.style_type_id = ?
          GROUP BY c.id, c.name ORDER BY c.name
        `, [t.id])
      }))
    }
  })
}

export function getAssetsByCategory(categoryId) {
  return queryAll('SELECT * FROM assets WHERE category_id = ? ORDER BY name', [categoryId])
}

// All assets across every category of one style_type (e.g. all of a style's
// Movement assets), excluding the junk '⚠ Uncategorized' bucket.
export function getAssetsByStyleType(styleTypeId) {
  return queryAll(`
    SELECT a.* FROM assets a
    JOIN categories c ON c.id = a.category_id
    WHERE c.style_type_id = ? AND c.name != '⚠ Uncategorized'
    ORDER BY a.name
  `, [styleTypeId])
}

export function hasData() {
  try {
    return (queryOne('SELECT COUNT(*) as count FROM styles')?.count ?? 0) > 0
  } catch { return false }
}