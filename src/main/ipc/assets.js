import { ipcMain, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { scanAssets, writeStyleName, readStyleNames } from '../scanner/index.js'
import {
  getDb, switchDb, reinitDb,
  getFullTree, getAssetsByCategory,
  hasData, saveDb, insertCategory, insertAsset,
  insertAssetFts, updateAssetFts, searchAssetsFts,
  getDbMtime, reloadFromDisk
} from '../db/index.js'
import { readSettings, writeSettings, getActiveAssetPath, getTemplatePath } from '../settings.js'
import { join } from 'path'

// Track DB mtime untuk deteksi perubahan remote
let lastDbMtime = 0

function getActivePath(settings) {
  const idx = settings.activePathIndex ?? 0
  return settings.assetPaths?.[idx]?.path ?? ''
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
    })
  }
  stmt.free()

  if (!assets.length) {
    console.log('[RAG] No assets with json_path to index')
    return
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

  // ─── GET STYLE NAMES ─────────────────────────────────────────
  ipcMain.handle('get-style-names', async () => {
    try {
      const settings   = readSettings()
      const activePath = getActivePath(settings)
      if (!activePath) {
        return { success: false, error: 'Asset path belum diset' }
      }
      const styleNames = readStyleNames(activePath)
      return { success: true, data: styleNames }
    } catch (err) {
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
      return { success: true, data: data.collections }
    } catch (err) {
      return { success: false, error: `Gagal baca collections: ${err.message}` }
    }
  })

  // Append collection ke Blender di port spesifik
  ipcMain.handle('blender-append', async (_e, { filePath, collection, port = BLENDER_PORT_START }) => {
    try {
      const res  = await fetch(`http://localhost:${port}/append`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ file: filePath, collection }),
        signal:  AbortSignal.timeout(15000),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: `Append gagal: ${err.message}` }
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
      const res  = await fetch(`${ragUrl}/rag-search`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query, style_id: styleId, limit }),
        signal:  AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.detail || `RAG error ${res.status}` }

      if (!data.results?.length) return { success: true, data: [] }

      const settings   = readSettings()
      const activePath = getActivePath(settings)
      const db         = await getDb(activePath)

      const ids          = data.results.map(r => r.asset_id)
      const placeholders = ids.map(() => '?').join(',')
      // Exclude '⚠ Uncategorized' as a safety net — Qdrant may still hold
      // stale entries from before a rescan that removed them from the index
      const stmt = db.prepare(`
        SELECT a.* FROM assets a
        JOIN categories c ON c.id = a.category_id
        WHERE a.id IN (${placeholders}) AND c.name != '⚠ Uncategorized'
      `)
      stmt.bind(ids)
      const rows = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()

      // Re-order by RAG score — SQLite IN does not preserve order
      const scoreMap    = Object.fromEntries(data.results.map(r => [r.asset_id, r]))
      const orderedRows = ids
        .map(id => rows.find(r => r.id === id))
        .filter(Boolean)
        .map(row => ({
          ...row,
          rag_score:         scoreMap[row.id]?.score,
          rag_asset_type:    scoreMap[row.id]?.asset_type,
          rag_category:      scoreMap[row.id]?.category,
          rag_style_type_id: scoreMap[row.id]?.style_type_id,
        }))

      return { success: true, data: orderedRows }
    } catch (err) {
      if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        return { success: false, error: `Cannot connect to RAG server at ${ragUrl}. Make sure rag_server.py is running.` }
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