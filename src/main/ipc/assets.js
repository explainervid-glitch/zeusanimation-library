import { ipcMain, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, rmSync, unlinkSync, statSync, readdirSync } from 'fs'
import { scanAssets, writeStyleName, writeStyleHints, readStyleNames } from '../scanner/index.js'
import {
  getDb, switchDb, reinitDb,
  getFullTree, getAssetsByCategory, getAssetsByStyleType,
  hasData, saveDb, insertCategory, insertAsset,
  insertAssetFts, updateAssetFts, searchAssetsFts,
  getDbMtime, reloadFromDisk
} from '../db/index.js'
import { readSettings, writeSettings, getActiveAssetPath, getTemplatePath } from '../settings.js'
import { join, basename, dirname, extname } from 'path'

// Track DB mtime untuk deteksi perubahan remote
let lastDbMtime = 0

function getActivePath(settings) {
  const idx = settings.activePathIndex ?? 0
  return settings.assetPaths?.[idx]?.path ?? ''
}

// Scrub LLM output for display: drop leftover chat-template tokens (Gemma's
// <end_of_turn> etc.). Markdown (**bold**, lists) and emoji are kept — the AI
// sidebar renders them.
function cleanLlmText(t) {
  if (!t) return ''
  let s = String(t)
  const cut = s.search(/<(end_of_turn|start_of_turn|turn|eos|bos)/i)
  if (cut !== -1) s = s.slice(0, cut)          // cut at the first turn marker
  s = s.replace(/<[^>\n]{0,40}>/g, '')          // stray <...> control tokens
  return s.trim()
}

// ─── STYLE GUIDE (tagger hint) ───────────────────────────────
// Reads the per-style `tagger_hint` from the pack's stylenames.json and
// returns it for the asset being tagged. The pack root is two levels up
// from the asset (…/<packRoot>/<image|background|movement|inspiration><N>/<file>).
// Suffix N is the style_id; hint is keyed by that suffix in stylenames.json.
// Returns '' on any miss, so tagging behaves exactly as before when no hint exists.
function styleGuideForAsset(assetPath) {
  try {
    const folder = basename(dirname(assetPath))
    const m      = folder.match(/^(background|image|movement|inspiration)(\d*)$/i)
    if (!m) return ''
    const suffix = m[2] || '0'

    const packRoot = dirname(dirname(assetPath))
    const namesPath = join(packRoot, 'stylenames.json')
    if (!existsSync(namesPath)) return ''

    const data  = JSON.parse(readFileSync(namesPath, 'utf-8'))
    const entry = data[String(suffix)] ?? data[String(Number(suffix) || 0)]
    if (entry && typeof entry === 'object' && entry.tagger_hint) {
      return String(entry.tagger_hint).trim()
    }
    return ''
  } catch {
    return ''
  }
}

// ─── RAG BULK INDEX HELPER ───────────────────────────────────
async function triggerRagBulkIndex(activePath, sender = null) {
  const emit = (data) => {
    if (sender && !sender.isDestroyed()) sender.send('rag-embed-progress', data)
  }
  const { ragUrl = 'http://192.168.1.27:8001' } = readSettings()
  const db = await getDb(activePath)

  // Exclude '⚠ Uncategorized' — these assets are unfinished/misplaced
  // and shouldn't show up in semantic search results
  const stmt = db.prepare(`
    SELECT
      a.id          as asset_id,
      a.json_path,
      c.name        as category_name,
      st.id         as style_type_id,
      st.type       as asset_type,
      st.style_id
    FROM assets a
    JOIN categories c   ON c.id  = a.category_id
    JOIN style_types st ON st.id = c.style_type_id
    WHERE a.json_path IS NOT NULL AND c.name != '⚠ Uncategorized'
    ORDER BY a.id
  `)

  const assets = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    let jsonData = {}
    try {
      if (existsSync(row.json_path)) {
        jsonData = JSON.parse(readFileSync(row.json_path, 'utf-8'))
      }
    } catch {}
    assets.push({
      asset_id:      row.asset_id,
      style_id:      row.style_id,
      style_type_id: row.style_type_id,
      asset_type:    row.asset_type,
      category:      row.category_name,
      json_data:     jsonData,
      json_path:     row.json_path,   // stable key (point id + join back)
      pack_id:       activePath,      // scopes search + delete-by-pack
    })
  }
  stmt.free()

  if (!assets.length) {
    console.log('[RAG] No assets with json_path to index')
    return
  }

  // Clear this pack's existing vectors first, so the re-embed REPLACES them
  // instead of piling new points next to stale ones (which orphaned search).
  try {
    await fetch(`${ragUrl}/rag-index/delete-pack`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pack_id: activePath }),
    })
    console.log(`[RAG] Cleared existing vectors for pack: ${activePath}`)
  } catch (e) {
    console.warn('[RAG] delete-pack failed (non-fatal, will upsert over):', e.message)
  }

  // Send in batches of 500 to avoid oversized payloads
  const BATCH_SIZE = 500
  const batches    = []
  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    batches.push(assets.slice(i, i + BATCH_SIZE))
  }

  console.log(`[RAG] Bulk indexing ${assets.length} assets in ${batches.length} batches to ${ragUrl}...`)
  emit({ status: 'started', total: assets.length, batches: batches.length })
  let totalIndexed = 0

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`[RAG] Sending batch ${i + 1}/${batches.length} (${batch.length} assets)...`)
    emit({ status: 'progress', batch: i + 1, totalBatches: batches.length, indexed: totalIndexed, total: assets.length })
    try {
      const res  = await fetch(`${ragUrl}/rag-index/bulk`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assets: batch }),
      })
      const data = await res.json()
      totalIndexed += data.indexed ?? data.total ?? batch.length
      console.log(`[RAG] Batch ${i + 1} done: ${data.indexed ?? '?'} indexed`)
    } catch (err) {
      console.warn(`[RAG] Batch ${i + 1} failed:`, err.message)
    }
  }

  console.log(`[RAG] All batches done: ${totalIndexed}/${assets.length} total indexed`)
  emit({ status: 'done', indexed: totalIndexed, total: assets.length })
  return totalIndexed
}

export async function registerIpcHandlers() {
  const initSettings = readSettings()
  const initPath     = getActivePath(initSettings)
  if (initPath) await getDb(initPath)
  lastDbMtime = getDbMtime()  // Initialize on startup
  console.log('[IPC] DB ready ✓')

  // ─── GET ASSET TREE ──────────────────────────────────────────
  ipcMain.handle('get-asset-tree', async () => {
    try {
      if (hasData()) return { success: true, data: getFullTree(), fromCache: true }
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      if (!activePath) return { success: true, data: [], fromCache: false }
      const stats = await scanAssets(activePath)
      saveDb()
      return { success: true, data: getFullTree(), fromCache: false, stats }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GET ASSETS BY CATEGORY ──────────────────────────────────
  ipcMain.handle('get-assets-by-category', async (_e, categoryId) => {
    try {
      return { success: true, data: getAssetsByCategory(categoryId) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GET ASSETS BY STYLE TYPE (all categories of a type) ─────
  ipcMain.handle('get-assets-by-style-type', async (_e, styleTypeId) => {
    try {
      return { success: true, data: getAssetsByStyleType(styleTypeId) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── RESCAN ──────────────────────────────────────────────────
  ipcMain.handle('rescan-assets', async () => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      if (!activePath) return { success: false, error: 'Asset path not set yet' }

      // Forward setiap log dari scanner ke renderer via 'scan-log' event
      const { BrowserWindow } = await import('electron')
      const win = BrowserWindow.getAllWindows()[0]
      const onLog = (msg) => {
        if (win && !win.isDestroyed()) win.webContents.send('scan-log', msg)
      }

      await reinitDb(activePath)
      const stats = await scanAssets(activePath, onLog)
      saveDb()

      // NOTE: RAG bulk indexing no longer auto-triggers after rescan.
      // It's now a separate, explicit action — see the 'rag-index-bulk'
      // handler below, wired to the "Re-embed Assets" button in the UI.
      // This keeps rescan fast and avoids re-embedding the entire pack
      // every time the user just wants to refresh the asset tree.

      return { success: true, data: getFullTree(), stats }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── SWITCH PACK ─────────────────────────────────────────────
  ipcMain.handle('switch-pack', async (_e, packIndex) => {
    try {
      const settings = readSettings()
      const pack     = settings.assetPaths?.[packIndex]
      if (!pack?.path) return { success: false, error: `Pack ${packIndex} has no path` }
      writeSettings({ activePathIndex: packIndex })
      await switchDb(pack.path)
      const tree    = getFullTree()
      return { success: true, data: tree, packIndex, isEmpty: tree.length === 0 }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── RENAME STYLE ────────────────────────────────────────────
  ipcMain.handle('rename-style', async (_e, { styleId, newName, newDescription }) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      const name        = (newName        || '').trim()
      const description = (newDescription || '').trim()
      writeStyleName(styleId, name, description, activePath)
      const db = await getDb(activePath)
      db.run('UPDATE styles SET display_name = ?, description = ? WHERE id = ?',
        [name, description, styleId])
      saveDb()
      return { success: true, data: getFullTree() }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── OPEN ASSET FILE ─────────────────────────────────────────
  ipcMain.handle('open-asset-file', async (_e, filePath) => {
    try {
      if (!filePath) return { success: false, error: 'Path not specified' }
      await shell.openPath(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── ADD ASSET ───────────────────────────────────────────────
  ipcMain.handle('add-asset', async (_e, templatePath) => {
    try {
      if (!templatePath) return { success: false, error: 'Template path not set' }
      await shell.openPath(templatePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── READ ASSET JSON ─────────────────────────────────────────
  ipcMain.handle('read-asset-json', async (_e, jsonPath) => {
    try {
      if (!jsonPath || !existsSync(jsonPath)) {
        return { success: false, error: 'JSON file not found' }
      }
      const content = JSON.parse(readFileSync(jsonPath, 'utf-8'))
      return { success: true, data: content }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── WRITE ASSET JSON ────────────────────────────────────────
  ipcMain.handle('write-asset-json', async (_e, { jsonPath, assetId, data }) => {
    try {
      if (!jsonPath) return { success: false, error: 'JSON path not specified' }
      writeFileSync(jsonPath, JSON.stringify(data, null, 4), 'utf-8')

      if (assetId) {
        const settings   = readSettings()
        const activePath = getActivePath(settings)
        const db         = await getDb(activePath)

        // 1. Update name & detail
        db.run('UPDATE assets SET name = ?, detail = ? WHERE id = ?',
          [data.FileName || null, data.Detail || null, assetId])

        // Ambil styleTypeId — selalu dibutuhkan untuk update search index
        const stStmt = db.prepare(`
          SELECT c.style_type_id FROM assets a
          JOIN categories c ON c.id = a.category_id
          WHERE a.id = ? LIMIT 1
        `)
        stStmt.bind([assetId])
        let styleTypeId = null
        if (stStmt.step()) styleTypeId = stStmt.getAsObject().style_type_id
        stStmt.free()

        // 2. Update category_id jika Category berubah
        if (data.Category && styleTypeId) {
          const catStmt = db.prepare(
            'SELECT id FROM categories WHERE style_type_id = ? AND name = ? LIMIT 1'
          )
          catStmt.bind([styleTypeId, data.Category])
          let newCategoryId = null
          if (catStmt.step()) newCategoryId = catStmt.getAsObject().id
          catStmt.free()

          if (newCategoryId) {
            db.run('UPDATE assets SET category_id = ? WHERE id = ?', [newCategoryId, assetId])
            console.log(`[IPC] Asset ${assetId} pindah kategori → id=${newCategoryId} (${data.Category})`)
          } else {
            console.warn(`[IPC] Category "${data.Category}" not found in style_type ${styleTypeId}`)
          }
        }

        // 3. Update search index
        if (styleTypeId) updateAssetFts(assetId, styleTypeId, data)

        saveDb()
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GET CATEGORIES FOR STYLE TYPE ───────────────────────────
  // Ambil daftar kategori dari DB berdasarkan style_type_id
  ipcMain.handle('get-type-categories', async (_e, styleTypeId) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      const db = await getDb(activePath)
      const stmt = db.prepare(
        'SELECT name FROM categories WHERE style_type_id = ? ORDER BY name'
      )
      stmt.bind([styleTypeId])
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject().name)
      stmt.free()
      return { success: true, data: rows }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GET SETTINGS ────────────────────────────────────────────
  ipcMain.handle('get-settings', async () => {
    try { return { success: true, data: readSettings() } }
    catch (err) { return { success: false, error: err.message } }
  })

  // ─── SAVE SETTINGS ───────────────────────────────────────────
  ipcMain.handle('save-settings', async (_e, newSettings) => {
    try {
      const saved = writeSettings(newSettings)
      return { success: true, data: saved }
    } catch (err) { return { success: false, error: err.message } }
  })

  // ─── SELECT FOLDER ───────────────────────────────────────────
  ipcMain.handle('select-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Pilih folder aset',
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (err) { return { success: false, error: err.message } }
  })

  // ─── CREATE PROJECT ──────────────────────────────────────────
  // Scaffolds a new project folder + its standard sub-folder tree.
  // Aborts if a folder with the same name already exists at parentPath.
  ipcMain.handle('create-project', async (_e, { parentPath, projectName } = {}) => {
    // Standard project sub-folder tree (relative to the project root).
    // recursive mkdir on each leaf creates all intermediate folders too.
    const PROJECT_FOLDER_TREE = [
      'Bahan/Aset Klien',
      'Bahan/Aset Visual',
      'Chars',
      'File Animator/File Animate',
      'File Animator/File Blender',
      'File Editing/SFX',
      'File Storyboard/File Animate/File Animate Blender',
      'File Storyboard/File Animate/Portrait Version/Revisions/Rev 1',
      'File Storyboard/File Animate/Portrait Version/Revisions/Rev 2',
      'File Storyboard/File Animate/Portrait Version/Revisions/Rev 3',
      'File Storyboard/File Animate/Revisions/Rev 1',
      'File Storyboard/File Animate/Revisions/Rev 2',
      'File Storyboard/File Animate/Revisions/Rev 3',
      'File Storyboard/File Animate/Square Version/Revisions/Rev 1',
      'File Storyboard/File Animate/Square Version/Revisions/Rev 2',
      'File Storyboard/File Animate/Square Version/Revisions/Rev 3',
      'File Storyboard/File Blender/Rendered Image',
      'Font',
      'VO',
    ]

    try {
      const parent = (parentPath || '').trim()
      const name   = (projectName || '').trim()

      if (!parent)  return { success: false, error: 'Please choose where to create the project.' }
      if (!name)    return { success: false, error: 'Please enter a project name.' }
      // Reject characters Windows/most filesystems disallow in folder names.
      if (/[\\/:*?"<>|]/.test(name)) {
        return { success: false, error: 'Project name contains invalid characters ( \\ / : * ? " < > | ).' }
      }
      if (!existsSync(parent)) {
        return { success: false, error: 'The selected location no longer exists.' }
      }

      const projectPath = join(parent, name)

      // Duplicate check — abort without touching anything.
      if (existsSync(projectPath)) {
        return { success: false, exists: true, error: `A folder named "${name}" already exists in this location.` }
      }

      // Create the tree. If it fails partway, roll back the folder we just
      // started so disk stays clean and a retry isn't blocked by a stray dir.
      try {
        for (const rel of PROJECT_FOLDER_TREE) {
          mkdirSync(join(projectPath, rel), { recursive: true })
        }
      } catch (mkErr) {
        try { rmSync(projectPath, { recursive: true, force: true }) } catch { /* best effort */ }
        return { success: false, error: `Failed to create project folders: ${mkErr.message}` }
      }

      return { success: true, data: projectPath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── SEND TO PROJECT ─────────────────────────────────────────
  // Copies a character asset into {projectPath}/Chars and returns the new path.
  // If the file already exists in the project, it is NOT overwritten (so any
  // edits made inside the project are preserved) — the existing copy is opened.
  ipcMain.handle('send-to-project', async (_e, { sourcePath, projectPath, targetName } = {}) => {
    try {
      if (!sourcePath || !existsSync(sourcePath)) {
        return { success: false, error: 'Source asset file not found.' }
      }
      if (!projectPath || !existsSync(projectPath)) {
        return { success: false, error: 'Active project folder not found. Create or select a project first.' }
      }

      const charsDir = join(projectPath, 'Chars')
      if (!existsSync(charsDir)) mkdirSync(charsDir, { recursive: true })

      // Destination filename: custom name if provided, else the source name.
      // basename() strips any path parts (no traversal); invalid chars rejected;
      // the source extension is re-appended if the custom name dropped it.
      let fileName = basename(sourcePath)
      if (targetName && targetName.trim()) {
        let cleaned = basename(targetName.trim())
        if (/[\\/:*?"<>|]/.test(cleaned)) {
          return { success: false, error: 'File name contains invalid characters ( \\ / : * ? " < > | ).' }
        }
        const srcExt = extname(sourcePath)
        if (srcExt && !extname(cleaned)) cleaned += srcExt
        fileName = cleaned
      }

      const destPath = join(charsDir, fileName)

      let copied = false
      if (!existsSync(destPath)) {
        copyFileSync(sourcePath, destPath)
        copied = true
      }

      return { success: true, data: destPath, copied }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── DELETE PROJECT FILE ─────────────────────────────────────
  // Cleanup for cancelled Send-to-Project / Link-to-Blender flows — removes
  // a file that was just copied into the project. Only ever unlinks a FILE
  // (never a directory), and is a no-op if it's already gone.
  ipcMain.handle('delete-project-file', async (_e, filePath) => {
    try {
      if (!filePath || !existsSync(filePath)) return { success: true }
      if (!statSync(filePath).isFile()) return { success: false, error: 'Refusing to delete: not a file' }
      unlinkSync(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── OPEN PATH (file or folder) in the OS ────────────────────
  ipcMain.handle('open-path', async (_e, targetPath) => {
    try {
      if (!targetPath) return { success: false, error: 'No path provided' }
      const err = await shell.openPath(targetPath)
      if (err) return { success: false, error: err }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GET STYLE NAMES ─────────────────────────────────────────
  // Optional packIndex targets a specific pack in assetPaths; omitted = active pack.
  ipcMain.handle('get-style-names', async (_e, { packIndex } = {}) => {
    try {
      const settings = readSettings()
      const path = (packIndex != null)
        ? (settings.assetPaths?.[packIndex]?.path ?? '')
        : getActivePath(settings)
      if (!path) {
        return { success: false, error: 'Asset path belum diset' }
      }
      return { success: true, data: readStyleNames(path) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── SAVE STYLE TAGGER HINTS ─────────────────────────────────
  // Writes per-style `tagger_hint` into a pack's stylenames.json.
  // payload: { hints: { [suffix]: "hint text", ... }, packIndex? }
  // packIndex omitted = active pack.
  ipcMain.handle('set-style-hints', async (_e, { hints, packIndex } = {}) => {
    try {
      const settings = readSettings()
      const path = (packIndex != null)
        ? (settings.assetPaths?.[packIndex]?.path ?? '')
        : getActivePath(settings)
      if (!path) return { success: false, error: 'Asset path belum diset' }
      writeStyleHints(hints || {}, path)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── GENERATE STYLE GUIDE (AI draft of a style's tagger hint) ─
  // Samples a few images from the style's folders and asks the tagger to
  // draft a hint. Returns { success, hint } for the user to review/edit.
  ipcMain.handle('generate-style-guide', async (_e, { packIndex, suffix, sampleSize = 5 } = {}) => {
    const settings = readSettings()
    const { taggerUrl = 'http://192.168.1.27:8000' } = settings
    const packRoot = (packIndex != null)
      ? (settings.assetPaths?.[packIndex]?.path ?? '')
      : getActivePath(settings)
    if (!packRoot) return { success: false, error: 'Asset path belum diset' }

    try {
      const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']
      const folders  = [`image${suffix}`, `background${suffix}`]
      const samples  = []
      for (const folder of folders) {
        const dir = join(packRoot, folder)
        if (!existsSync(dir)) continue
        for (const file of readdirSync(dir)) {
          if (file.toLowerCase().startsWith('categories')) continue
          if (IMG_EXTS.includes(extname(file).toLowerCase())) {
            samples.push(join(dir, file))
            if (samples.length >= sampleSize) break
          }
        }
        if (samples.length >= sampleSize) break
      }

      if (!samples.length) {
        return { success: false, error: 'No sample images found for this style' }
      }

      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' }
      const form = new FormData()
      for (const p of samples) {
        const buf  = readFileSync(p)
        const mime = mimeMap[extname(p).toLowerCase()] || 'image/jpeg'
        form.append('files', new Blob([buf], { type: mime }), basename(p))
      }

      const res  = await fetch(`${taggerUrl}/generate-style-guide`, {
        method: 'POST',
        body:   form,
        signal: AbortSignal.timeout(120000),
      })
      const data = await res.json()
      if (!res.ok) {
        const errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        return { success: false, error: errMsg || `Tagger error ${res.status}` }
      }
      return { success: true, hint: data.hint || '', sampled: samples.length }
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to tagger server at ${taggerUrl}. Make sure tagger_server.py is running.` }
      }
      return { success: false, error: err.message }
    }
  })

  // ─── ADD CATEGORY ───────────────────────────────────────────
  ipcMain.handle('add-category', async (_e, { styleSuffix, assetType, categoryName }) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      if (!activePath) {
        return { success: false, error: 'Asset path belum diset' }
      }

      // Map asset type ke prefix dan type untuk DB
      const prefixMap = {
        'background': 'background',
        'image': 'image',
        'movement': 'movement',
      }
      const typeMap = {
        'background': 'background',
        'image': 'character',
        'movement': 'animation',
      }
      const prefix = prefixMap[assetType]
      const type = typeMap[assetType]
      if (!prefix || !type) {
        return { success: false, error: `Unknown asset type: ${assetType}` }
      }

      // Cari file categories JSON dengan variasi nama
      const candidates = [
        `categories${prefix}${styleSuffix}.json`,
        `categories${prefix}.json`,
        `categories_${prefix}${styleSuffix}.json`,
        `categories_${prefix}.json`,
      ]

      let jsonPath = null
      for (const filename of candidates) {
        const fullPath = join(activePath, filename)
        if (existsSync(fullPath)) {
          jsonPath = fullPath
          break
        }
      }

      if (!jsonPath) {
        // Jika tidak ada, buat file baru dengan nama standar
        jsonPath = join(activePath, `categories${prefix}${styleSuffix}.json`)
      }

      // Baca isi JSON — preserve format asli (array flat atau object {categories:[]})
      let categories = []
      let isObjectFormat = false
      if (existsSync(jsonPath)) {
        try {
          const content = JSON.parse(readFileSync(jsonPath, 'utf-8'))
          if (Array.isArray(content)) {
            categories = content
            isObjectFormat = false
          } else {
            categories = content.categories || []
            isObjectFormat = true
          }
        } catch (err) {
          console.warn('[IPC] Gagal parse categories JSON:', err.message)
        }
      }

      // Jika kategori sudah ada, return error
      if (categories.includes(categoryName)) {
        return { success: false, error: `Kategori "${categoryName}" sudah ada` }
      }

      // Tambah kategori baru & simpan dengan format yang sama
      categories.push(categoryName)
      const toWrite = isObjectFormat ? { categories } : categories
      writeFileSync(jsonPath, JSON.stringify(toWrite, null, 2), 'utf-8')
      console.log(`[IPC] Kategori ditambahkan ke JSON: ${categoryName} ke ${jsonPath}`)

      // ─── INSERT KE DATABASE ───────────────────────────────────
      const db = await getDb(activePath)
      if (db) {
        try {
          // Query untuk mendapat style_type_id berdasarkan style_id dan type
          const stmt = db.prepare(
            'SELECT id FROM style_types WHERE style_id = ? AND type = ? LIMIT 1'
          )
          stmt.bind([Number(styleSuffix) || 0, type])
          let styleTypeId = null
          if (stmt.step()) {
            styleTypeId = stmt.getAsObject().id
          }
          stmt.free()

          if (styleTypeId) {
            insertCategory(styleTypeId, categoryName)
            saveDb()
            console.log(`[IPC] Kategori juga ditambahkan ke DB: style_type_id=${styleTypeId}, name=${categoryName}`)
          } else {
            console.warn(`[IPC] style_type_id tidak ditemukan untuk style_id=${styleSuffix} dan type=${type}`)
          }
        } catch (dbErr) {
          console.error('[IPC] Error saat insert ke DB:', dbErr.message)
        }
      }

      return { success: true, data: { categoryName, jsonPath } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── DELETE CATEGORY ──────────────────────────────────────────
  // Hapus kategori dari categories JSON + DB
  // Asset yang ada di kategori ini dipindah ke Uncategorized (tidak dihapus)
  ipcMain.handle('delete-category', async (_e, { styleSuffix, assetType, categoryName, categoryId }) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      if (!activePath) return { success: false, error: 'Asset path belum diset' }

      const prefixMap = {
        background:  'background',
        image:       'image',
        movement:    'movement',
        inspiration: 'inspiration',
      }
      const typeMap = {
        background:  'background',
        image:       'character',
        movement:    'animation',
        inspiration: 'inspiration',
      }
      const prefix = prefixMap[assetType]
      const type   = typeMap[assetType]
      if (!prefix || !type) return { success: false, error: `Unknown asset type: ${assetType}` }

      // ── 1. Hapus dari categories JSON ────────────────────────
      const candidates = [
        `categories${prefix}${styleSuffix}.json`,
        `categories${prefix}.json`,
        `categories_${prefix}${styleSuffix}.json`,
        `categories_${prefix}.json`,
      ]
      let jsonPath = null
      for (const filename of candidates) {
        const fullPath = join(activePath, filename)
        if (existsSync(fullPath)) { jsonPath = fullPath; break }
      }

      if (jsonPath) {
        try {
          const content = JSON.parse(readFileSync(jsonPath, 'utf-8'))
          let categories, isObjectFormat
          if (Array.isArray(content)) {
            categories     = content
            isObjectFormat = false
          } else {
            categories     = content.categories || []
            isObjectFormat = true
          }
          const filtered = categories.filter(c => c !== categoryName)
          const toWrite  = isObjectFormat ? { categories: filtered } : filtered
          writeFileSync(jsonPath, JSON.stringify(toWrite, null, 2), 'utf-8')
          console.log(`[IPC] Kategori dihapus dari JSON: ${categoryName} di ${jsonPath}`)
        } catch (e) {
          console.warn('[IPC] Gagal update categories JSON:', e.message)
        }
      }

      // ── 2. Hapus dari DB + pindahkan aset ke Uncategorized ───
      const db = await getDb(activePath)

      // Cari atau buat kategori Uncategorized di style_type yang sama
      const numSuffix  = Number(styleSuffix) || 0
      const stStmt     = db.prepare('SELECT id FROM style_types WHERE style_id = ? AND type = ? LIMIT 1')
      stStmt.bind([numSuffix, type])
      let styleTypeId = null
      if (stStmt.step()) styleTypeId = stStmt.getAsObject().id
      stStmt.free()

      if (styleTypeId) {
        // Cek apakah sudah ada Uncategorized
        const uncatStmt = db.prepare(
          "SELECT id FROM categories WHERE style_type_id = ? AND name = '⚠ Uncategorized' LIMIT 1"
        )
        uncatStmt.bind([styleTypeId])
        let uncatId = null
        if (uncatStmt.step()) uncatId = uncatStmt.getAsObject().id
        uncatStmt.free()

        // Buat jika belum ada
        if (!uncatId) {
          uncatId = insertCategory(styleTypeId, '⚠ Uncategorized')
          console.log(`[IPC] Uncategorized dibuat untuk style_type_id=${styleTypeId}`)
        }

        // Pindahkan semua aset dari kategori yang dihapus → Uncategorized
        if (categoryId && uncatId) {
          db.run('UPDATE assets SET category_id = ? WHERE category_id = ?', [uncatId, categoryId])
          console.log(`[IPC] Aset dari category_id=${categoryId} dipindah ke Uncategorized (id=${uncatId})`)
        }
      }

      // Hapus kategori dari DB
      if (categoryId) {
        db.run('DELETE FROM categories WHERE id = ?', [categoryId])
        console.log(`[IPC] Kategori dihapus dari DB: id=${categoryId}, name=${categoryName}`)
      }

      saveDb()
      return { success: true }
    } catch (err) {
      console.error('[IPC] delete-category error:', err)
      return { success: false, error: err.message }
    }
  })

  // ─── SELECT FILE (untuk browse template) ─────────────────────
  ipcMain.handle('select-file', async (_e, filters) => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Pilih file template',
        filters: filters || [
          { name: 'Template Files', extensions: ['fla', 'blend'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

// Tambahkan di assets.js sebelum: console.log('[IPC] All handlers registered ✓')
// Tambahkan juga di imports: import { copyFileSync, mkdirSync } from 'fs'

// Ganti seluruh handler 'create-asset' yang lama dengan ini
// Pastikan import di atas assets.js sudah ada:
//   import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
//   import { insertAsset } from '../db/index.js'   ← pastikan di-export dari db/index.js

  // ─── CREATE ASSET ─────────────────────────────────────────────
  ipcMain.handle('create-asset', async (_e, {
    styleSuffix,   // suffix folder style, e.g. "" atau "2"
    assetType,     // 'background' | 'image' | 'movement' | 'inspiration'
    categoryName,
    fileName,
    detail,
  }) => {
    try {
      const settings   = readSettings()
      const packIndex  = settings.activePathIndex ?? 0
      const activePath = getActivePath(settings)
      if (!activePath) return { success: false, error: 'Asset path belum diset' }

      const is3D = packIndex === 1   // Pack index 1 = 3D

      // ── Template mapping ─────────────────────────────────────
      // inspiration → bg template (2D atau 3D tergantung pack)
      // background  → bg template
      // image / movement → animation template
      let templateId
      if (assetType === 'background' || assetType === 'inspiration') {
        templateId = is3D ? 'bg_3d' : 'bg_2d'
      } else {
        // image, movement
        templateId = is3D ? 'anim_3d' : 'anim_2d'
      }

      const templatePath = settings.templatePaths?.find(t => t.id === templateId)?.path
      if (!templatePath || !existsSync(templatePath)) {
        return {
          success: false,
          error: `Template "${templateId}" belum diset atau file tidak ditemukan. Atur di Settings.`
        }
      }

      // ── Folder prefix mapping ─────────────────────────────────
      const prefixMap = {
        background:  'background',
        image:       'image',
        movement:    'movement',
        inspiration: 'inspiration',
      }
      const prefix = prefixMap[assetType]
      if (!prefix) return { success: false, error: `Unknown asset type: ${assetType}` }

      // Suffix "0" atau "" → folder tanpa angka (e.g. "background")
      // Suffix "2" → "background2"
      const numSuffix  = Number(styleSuffix) || 0
      const folderName = numSuffix === 0 ? prefix : `${prefix}${numSuffix}`
      const folderPath = join(activePath, folderName)

      if (!existsSync(folderPath)) {
        return { success: false, error: `Folder "${folderName}" tidak ditemukan di ${activePath}` }
      }

      // ── Cek duplikat ─────────────────────────────────────────
      const ext      = templatePath.split('.').pop()
      const rawDest  = join(folderPath, `${fileName}.${ext}`)
      const jsonDest = join(folderPath, `${fileName}.json`)

      if (existsSync(rawDest) || existsSync(jsonDest)) {
        return { success: false, error: `Asset "${fileName}" sudah ada`, duplicate: true }
      }

      // ── Copy template ─────────────────────────────────────────
      copyFileSync(templatePath, rawDest)

      // ── Buat JSON aset ────────────────────────────────────────
      const jsonData = {
        FileName: fileName,
        Detail:   detail || '',
        Category: categoryName,
      }
      writeFileSync(jsonDest, JSON.stringify(jsonData, null, 4), 'utf-8')

      // ── Insert ke DB ──────────────────────────────────────────
      const typeMap = {
        background:  'background',
        image:       'character',
        movement:    'animation',
        inspiration: 'inspiration',
      }
      const type = typeMap[assetType]
      const db   = await getDb(activePath)

      // Cari style_type_id
      const stStmt = db.prepare(
        'SELECT id FROM style_types WHERE style_id = ? AND type = ? LIMIT 1'
      )
      stStmt.bind([numSuffix, type])
      let styleTypeId = null
      if (stStmt.step()) styleTypeId = stStmt.getAsObject().id
      stStmt.free()

      if (!styleTypeId) {
        return { success: false, error: `Style type tidak ditemukan (style=${styleSuffix}, type=${type})` }
      }

      // Cari category_id
      const catStmt = db.prepare(
        'SELECT id FROM categories WHERE style_type_id = ? AND name = ? LIMIT 1'
      )
      catStmt.bind([styleTypeId, categoryName])
      let categoryId = null
      if (catStmt.step()) categoryId = catStmt.getAsObject().id
      catStmt.free()

      if (!categoryId) {
        return { success: false, error: `Category "${categoryName}" tidak ditemukan` }
      }

      const newAssetId = insertAsset({
        categoryId,
        name:        fileName,
        detail:      detail || null,
        rawPath:     rawDest,
        mp4Path:     null,
        jsonPath:    jsonDest,
        ragJsonPath: null,
      })

      // ── Populate search index ───────────────────────────────
      if (newAssetId) {
        insertAssetFts(newAssetId, styleTypeId, jsonData)
      }
      saveDb()

      console.log(`[IPC] Asset created: ${fileName} in ${folderName}/${categoryName}`)
      return { success: true, data: { fileName, rawPath: rawDest, jsonPath: jsonDest } }

    } catch (err) {
      console.error('[IPC] create-asset error:', err)
      return { success: false, error: err.message }
    }
  })

  // Tambahkan di assets.js sebelum: console.log('[IPC] All handlers registered ✓')

// ─── BLENDER BRIDGE ──────────────────────────────────────────
  const BLENDER_PORT_START = 7334
  const BLENDER_PORT_END   = 7344

  // Scan semua port → return list instance Blender yang aktif
  ipcMain.handle('blender-scan-ports', async () => {
    const found = []
    const checks = []

    for (let port = BLENDER_PORT_START; port < BLENDER_PORT_END; port++) {
      checks.push(
        fetch(`http://localhost:${port}/ping`, { signal: AbortSignal.timeout(800) })
          .then(res => res.json())
          .then(data => {
            found.push({
              port,
              file:    data.file    || null,
              blender: data.blender || '',
            })
          })
          .catch(() => {})  // port tidak aktif, skip
      )
    }

    await Promise.all(checks)
    // Urutkan berdasarkan port
    found.sort((a, b) => a.port - b.port)
    return found
  })

  // Ambil collections dari file .blend via port spesifik
  ipcMain.handle('blender-get-collections', async (_e, filePath, port = BLENDER_PORT_START) => {
    try {
      const encoded = encodeURIComponent(filePath)
      const res     = await fetch(
        `http://localhost:${port}/collections?file=${encoded}`,
        { signal: AbortSignal.timeout(5000) }
      )
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      // Sort collections alphabetically (case/number-aware) for every consumer
      // — Append, Import/Link, and Compile modals all use this handler.
      const sorted = (data.collections || []).slice().sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      )
      return { success: true, data: sorted }
    } catch (err) {
      return { success: false, error: `Gagal baca collections: ${err.message}` }
    }
  })

  // Append collection ke Blender di port spesifik
  ipcMain.handle('blender-append', async (_e, { filePath, collection, port = BLENDER_PORT_START, tempScene = false }) => {
    try {
      const res  = await fetch(`http://localhost:${port}/append`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ file: filePath, collection, temp_scene: tempScene }),
        signal:  AbortSignal.timeout(15000),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: `Append gagal: ${err.message}` }
    }
  })

  // Link (bukan append) collection ke Blender di port spesifik
  ipcMain.handle('blender-link', async (_e, { filePath, collection, port = BLENDER_PORT_START }) => {
    try {
      const res  = await fetch(`http://localhost:${port}/link`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ file: filePath, collection }),
        signal:  AbortSignal.timeout(15000),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: `Link gagal: ${err.message}` }
    }
  })

  // ─── SEARCH ASSETS ───────────────────────────────────────────
  ipcMain.handle('search-assets', async (_e, { styleTypeId, query }) => {
    try {
      const trimmed = (query || '').trim()
      if (!trimmed) return { success: true, data: [] }
      const rows = searchAssetsFts(styleTypeId, trimmed)
      return { success: true, data: rows }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── AI TAGGER ────────────────────────────────────────────────
  // Import readSettings di top file jika belum ada:
  // import { readSettings } from '../settings.js'

  ipcMain.handle('tagger-ping', async () => {
    const { taggerUrl = 'http://192.168.1.27:8000' } = readSettings()
    try {
      const res = await fetch(`${taggerUrl}/docs`, { signal: AbortSignal.timeout(3000) })
      return { success: res.ok, url: taggerUrl }
    } catch {
      return { success: false, url: taggerUrl }
    }
  })

// Ganti handler 'tagger-generate' yang lama dengan ini

  ipcMain.handle('tagger-generate', async (_e, { thumbnailPath, assetType, jsonPath }) => {
    if (!thumbnailPath) return { success: false, error: 'No preview image path provided' }
    if (!['background', 'character', 'inspiration'].includes(assetType)) {
      return { success: false, error: `Asset type '${assetType}' not supported by tagger` }
    }

    const { taggerUrl = 'http://192.168.1.27:8000' } = readSettings()

    try {
      const fs   = await import('fs')
      const path = await import('path')

      if (!fs.default.existsSync(thumbnailPath)) {
        return { success: false, error: `Preview image not found: ${thumbnailPath}` }
      }

      const imageBuffer = fs.default.readFileSync(thumbnailPath)
      const filename    = path.default.basename(thumbnailPath)

      const ext      = path.default.extname(filename).toLowerCase()
      const mimeMap  = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' }
      const mimeType = mimeMap[ext] || 'image/jpeg'

      const blob = new Blob([imageBuffer], { type: mimeType })
      const form = new FormData()
      form.append('file',       blob, filename)
      form.append('asset_type', assetType)

      // Per-style visual guidance so the AI doesn't misread the style
      // (e.g. monochrome ground tagged as "snow"). Empty if none set.
      const styleGuide = styleGuideForAsset(thumbnailPath)
      if (styleGuide) form.append('style_guide', styleGuide)

      // Kirim json_path ke server agar server bisa:
      // 1. Baca existing JSON → isi hanya field kosong
      // 2. Simpan hasil ke asset path (replace, bukan suffix)
      if (jsonPath) {
        form.append('json_path', jsonPath)
        form.append('filename',  path.default.basename(jsonPath, path.default.extname(jsonPath)))
      }

      const res  = await fetch(`${taggerUrl}/auto-tag`, {
        method: 'POST',
        body:   form,
        signal: AbortSignal.timeout(120000),
      })

      const data = await res.json()

      if (!res.ok) {
        const errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        return { success: false, error: errMsg || `Tagger error ${res.status}` }
      }

      // Server sudah simpan JSON ke asset path
      // App cukup pakai result untuk update UI
      return { success: true, data }

    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to tagger server at ${taggerUrl}. Make sure the server is running.` }
      }
      return { success: false, error: err.message }
    }
  })

  // ─── AI VIDEO TAGGER ─────────────────────────────────────────
  // Separate server on port 8001 — handles animation mp4 previews

  ipcMain.handle('tagger-ping-video', async () => {
    // Video tagger now runs on the same server as image tagger (new_main.py, port 8000)
    const { taggerUrl = 'http://192.168.1.27:8000' } = readSettings()
    try {
      const res = await fetch(`${taggerUrl}/docs`, { signal: AbortSignal.timeout(3000) })
      return { success: res.ok, url: taggerUrl }
    } catch {
      return { success: false, url: taggerUrl }
    }
  })

  ipcMain.handle('rag-ping', async () => {
    const { ragUrl = 'http://192.168.1.27:8001' } = readSettings()
    try {
      const res = await fetch(`${ragUrl}/rag-status`, { signal: AbortSignal.timeout(10000) })
      return { success: res.ok || res.status === 200, url: ragUrl }
    } catch (error) {
      console.error('RAG ping error:', error.message)
      return { success: false, url: ragUrl }
    }
  })

  ipcMain.handle('tagger-generate-video', async (_e, { videoPath, jsonPath, filename }) => {
    if (!videoPath) return { success: false, error: 'No video path provided' }

    // Uses the same server as image tagger (new_main.py, port 8000)
    // Endpoint: /auto-tag-video — does NOT require asset_type field
    const { taggerUrl = 'http://192.168.1.27:8000' } = readSettings()

    try {
      const fs   = await import('fs')
      const path = await import('path')

      if (!fs.default.existsSync(videoPath)) {
        return { success: false, error: `Video file not found: ${videoPath}` }
      }

      const videoBuffer = fs.default.readFileSync(videoPath)
      const fname       = filename || path.default.basename(videoPath)

      const ext      = path.default.extname(fname).toLowerCase()
      const mimeMap  = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo' }
      const mimeType = mimeMap[ext] || 'video/mp4'

      const blob = new Blob([videoBuffer], { type: mimeType })
      const form = new FormData()
      form.append('file', blob, fname)

      // Per-style visual guidance (same hint used for image tagging)
      const styleGuide = styleGuideForAsset(videoPath)
      if (styleGuide) form.append('style_guide', styleGuide)

      if (jsonPath) {
        form.append('json_path', jsonPath)
        form.append('filename',  path.default.basename(jsonPath, path.default.extname(jsonPath)))
      }

      const res  = await fetch(`${taggerUrl}/auto-tag-video`, {
        method: 'POST',
        body:   form,
        signal: AbortSignal.timeout(180000),
      })

      const data = await res.json()

      if (!res.ok) {
        const errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
        return { success: false, error: errMsg || `Video tagger error ${res.status}` }
      }

      return { success: true, data }

    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to tagger server at ${taggerUrl}. Make sure new_main.py is running.` }
      }
      return { success: false, error: err.message }
    }
  })

  // ─── DELETE ASSET ────────────────────────────────────────────
  ipcMain.handle('delete-asset', async (_e, { assetId }) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      const db         = await getDb(activePath)

      const stmt = db.prepare('SELECT * FROM assets WHERE id = ? LIMIT 1')
      stmt.bind([assetId])
      let asset = null
      if (stmt.step()) asset = stmt.getAsObject()
      stmt.free()

      if (!asset) return { success: false, error: 'Asset not found' }

      // Hapus file dari disk (error per file tidak stop proses)
      const { unlinkSync } = await import('fs')
      const tryDelete = (p) => {
        try { if (p && existsSync(p)) { unlinkSync(p); console.log(`[IPC] Deleted: ${p}`) } }
        catch (e) { console.warn(`[IPC] Cannot delete ${p}:`, e.message) }
      }
      tryDelete(asset.raw_path)
      tryDelete(asset.mp4_path)
      tryDelete(asset.json_path)
      tryDelete(asset.rag_json_path)

      // Hapus dari DB
      db.run('DELETE FROM assets_search WHERE asset_id = ?', [assetId])
      db.run('DELETE FROM assets WHERE id = ?', [assetId])
      saveDb()

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── SET ASSET PREVIEW ───────────────────────────────────────
  ipcMain.handle('set-asset-preview', async (_e, { assetId, previewPath }) => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      const db         = await getDb(activePath)
      db.run('UPDATE assets SET mp4_path = ? WHERE id = ?', [previewPath, assetId])
      saveDb()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── SCAN PREVIEW FILE (auto-detect) ─────────────────────────
  ipcMain.handle('scan-preview-file', async (_e, { folderPath, assetName }) => {
    try {
      if (!folderPath || !existsSync(folderPath)) return { success: false }
      const { readdirSync } = await import('fs')
      const pathMod = await import('path')
      const PREVIEW_EXTS = ['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp']
      const nameLower = assetName.toLowerCase()
      const files     = readdirSync(folderPath)
      const found     = files.find(f => {
        const base = pathMod.basename(f, pathMod.extname(f)).toLowerCase()
        return base === nameLower && PREVIEW_EXTS.includes(pathMod.extname(f).toLowerCase())
      })
      if (found) return { success: true, data: pathMod.join(folderPath, found) }
      return { success: false }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ─── CHECK DB UPDATED (Remote polling) ───────────────────────
  // Deteksi jika DB di-update oleh PC lain (NAS/network)
  ipcMain.handle('check-db-updated', async (_e, { categoryId } = {}) => {
    try {
      const currentMtime = getDbMtime()
      const updated = currentMtime > lastDbMtime

      if (updated) {
        console.log(`[IPC] DB update detected: mtime ${lastDbMtime} → ${currentMtime}`)
        reloadFromDisk()
        lastDbMtime = currentMtime
      }

      // Return status dan optionally data jika diminta
      return {
        updated,
        tree: updated ? getFullTree() : null,
        assets: updated && categoryId ? getAssetsByCategory(categoryId) : null,
      }
    } catch (err) {
      console.error('[IPC] check-db-updated error:', err)
      return { updated: false, error: err.message }
    }
  })

  // ─── RAG: SEMANTIC SEARCH ────────────────────────────────────
  ipcMain.handle('rag-search', async (_e, { query, styleId, limit = 10 }) => {
    const { ragUrl = 'http://192.168.1.27:8001' } = readSettings()
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)

      const res  = await fetch(`${ragUrl}/rag-search`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query, style_id: styleId, pack_id: activePath, limit }),
        signal:  AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.detail || `RAG error ${res.status}` }

      if (!data.results?.length) return { success: true, data: [] }

      const db = await getDb(activePath)

      // Join on json_path (the stable key) — asset ids change on every rescan,
      // so joining on id would drop everything after a rescan.
      const paths = data.results.map(r => r.json_path).filter(Boolean)
      if (!paths.length) return { success: true, data: [] }

      const placeholders = paths.map(() => '?').join(',')
      const stmt = db.prepare(`
        SELECT a.* FROM assets a
        JOIN categories c ON c.id = a.category_id
        WHERE a.json_path IN (${placeholders}) AND c.name != '⚠ Uncategorized'
      `)
      stmt.bind(paths)
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()

      // Re-order by RAG score — SQLite IN does not preserve order
      const scoreMap  = Object.fromEntries(data.results.map(r => [r.json_path, r]))
      const rowByPath = Object.fromEntries(rows.map(r => [r.json_path, r]))
      const orderedRows = paths
        .map(p => rowByPath[p])
        .filter(Boolean)
        .map(row => ({
          ...row,
          rag_score:         scoreMap[row.json_path]?.score,
          rag_asset_type:    scoreMap[row.json_path]?.asset_type,
          rag_category:      scoreMap[row.json_path]?.category,
          rag_style_type_id: scoreMap[row.json_path]?.style_type_id,
        }))

      return { success: true, data: orderedRows }
    } catch (err) {
      if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to RAG server at ${ragUrl}. Make sure rag_server.py is running.` }
      }
      return { success: false, error: err.message }
    }
  })

  // ─── AI: GENERATE TEXT FROM RAG RESULTS ──────────────────────
  // The "adapter" step: turn the query + retrieved candidates into a prompt
  // and send it to the local LLM (Gemma on :8002). Swap llmUrl to point at a
  // different provider later — nothing else changes.
  ipcMain.handle('ai-generate', async (_e, { query, results = [] }) => {
    const { llmUrl = 'http://192.168.1.27:8002' } = readSettings()
    if (!query || !results.length) return { success: false, error: 'Nothing to generate from.' }

    // Compact the top candidates into a numbered list for the model.
    const context = results.slice(0, 12).map((a, i) => {
      const type   = a.rag_asset_type || ''
      const cat    = a.rag_category || a.category || ''
      const detail = a.detail ? ` — ${a.detail}` : ''
      return `${i + 1}. ${a.name} [${type}${cat ? '/' + cat : ''}]${detail}`
    }).join('\n')

    const system =
      'You help a video producer choose animation assets from a library. ' +
      'Given their scene and a numbered list of retrieved candidate assets, ' +
      'recommend the best few and briefly say why each fits. Keep it short. ' +
      'Only reference assets from the list, by name. You may use light Markdown ' +
      '(**bold** for asset names, simple "- " bullet lists) and the occasional ' +
      'tasteful emoji. Do not use headings.'
    const prompt = `Scene: ${query}\n\nCandidate assets:\n${context}\n\nRecommend the best matches and explain why.`

    try {
      const res = await fetch(`${llmUrl}/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ system, prompt, max_tokens: 512 }),
        signal:  AbortSignal.timeout(60000),   // local gen can be slow, esp. first call
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.detail || `LLM error ${res.status}` }
      return { success: true, text: cleanLlmText(data.text) }
    } catch (err) {
      if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to LLM server at ${llmUrl}. Make sure llm_server.py is running.` }
      }
      return { success: false, error: err.message }
    }
  })

  // ─── RAG: INDEX UPSERT (single asset after edit/tag) ─────────
  ipcMain.handle('rag-index-upsert', async (_e, payload) => {
    const { ragUrl = 'http://192.168.1.27:8001' } = readSettings()
    try {
      await fetch(`${ragUrl}/rag-index/upsert`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(15000),
      })
      return { success: true }
    } catch (err) {
      console.warn('[IPC] rag-index-upsert failed (non-critical):', err.message)
      return { success: false, error: err.message }
    }
  })

  // ─── RAG: INDEX BULK (manual trigger from renderer if needed) ──
  ipcMain.handle('rag-index-bulk', async (event) => {
    const settings   = readSettings()
    const activePath = getActivePath(settings)
    const sender     = event.sender

    // Return immediately — embedding runs in background
    // Progress sent via 'rag-embed-progress' events
    setImmediate(async () => {
      try {
        await triggerRagBulkIndex(activePath, sender)
      } catch (err) {
        console.warn('[IPC] rag-index-bulk failed:', err.message)
        if (!sender.isDestroyed()) {
          sender.send('rag-embed-progress', { status: 'error', error: err.message })
        }
      }
    })

    return { success: true, message: 'Embedding started in background' }
  })

  // ─── RAG: INDEX DELETE (after delete-asset) ──────────────────
  ipcMain.handle('rag-index-delete', async (_e, { assetId }) => {
    const { ragUrl = 'http://192.168.1.27:8001' } = readSettings()
    try {
      await fetch(`${ragUrl}/rag-index/${assetId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      })
      return { success: true }
    } catch (err) {
      console.warn('[IPC] rag-index-delete failed (non-critical):', err.message)
      return { success: false, error: err.message }
    }
  })

  console.log('[IPC] All handlers registered ✓')
}