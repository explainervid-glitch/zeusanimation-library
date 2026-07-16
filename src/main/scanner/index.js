import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, parse } from 'path'
import {
  clearAll,
  insertStyle,
  insertStyleType,
  insertCategory,
  insertAsset,
  insertAssetFts,
  saveDb,
  reloadFromDisk
} from '../db/index.js'

const FOLDER_TYPE_MAP = {
  background:  'background',
  image:       'character',
  movement:    'animation',
  inspiration: 'inspiration',
}

const FOLDER_REGEX = /^(background|image|movement|inspiration)(\d*)$/i

// ── Normalize string untuk fuzzy matching ────────────────────
// Hapus karakter non-alphanumeric, lowercase, trim spasi
function normalize(str) {
  if (!str) return ''
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

// ─────────────────────────────────────────────────────────────
// STYLENAMES.JSON
// ─────────────────────────────────────────────────────────────
export function readStyleNames(root) {
  const path = join(root, 'stylenames.json')
  if (!existsSync(path)) return {}
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    const result = {}
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'string') {
        result[key] = { name: val, description: '' }
      } else if (val && typeof val === 'object') {
        result[key] = {
          ...val,   // preserve extra fields (e.g. tagger_hint) across reads/writes
          name:        (val.name        || '').trim(),
          description: (val.description || '').trim(),
        }
      }
    }
    return result
  } catch (e) {
    console.warn('[Scanner] Gagal parse stylenames.json:', e.message)
    return {}
  }
}

export function writeStyleName(suffix, name, description = '', root) {
  if (!root) throw new Error('[writeStyleName] root tidak boleh kosong')
  const path    = join(root, 'stylenames.json')
  const current = readStyleNames(root)

  current[String(suffix)] = {
    ...(current[String(suffix)] || {}),   // keep tagger_hint & any other fields
    name:        (name        || '').trim(),
    description: (description || '').trim(),
  }

  writeFileSync(path, JSON.stringify(current, null, 2), 'utf-8')
  console.log(`[Scanner] stylenames.json updated: key="${suffix}" name="${name}" desc="${description}"`)
}

// Save per-style tagger hints (keyed by suffix) into stylenames.json.
// Preserves name/description and any other fields on each entry.
export function writeStyleHints(hintMap, root) {
  if (!root) throw new Error('[writeStyleHints] root tidak boleh kosong')
  const path    = join(root, 'stylenames.json')
  const current = readStyleNames(root)

  for (const [suffix, hint] of Object.entries(hintMap || {})) {
    const key    = String(suffix)
    current[key] = { ...(current[key] || {}), tagger_hint: (hint || '').trim() }
  }

  writeFileSync(path, JSON.stringify(current, null, 2), 'utf-8')
  console.log(`[Scanner] stylenames.json hints updated: ${Object.keys(hintMap || {}).length} styles`)
  return true
}

// ─────────────────────────────────────────────────────────────
// BACA CATEGORIES JSON
// ─────────────────────────────────────────────────────────────
function readCategoriesForFolder(root, prefix, suffix) {
  const candidates = [
    `categories${prefix}${suffix}.json`,
    `categories${prefix}.json`,
    `categories_${prefix}${suffix}.json`,
    `categories_${prefix}.json`,
  ]

  for (const filename of candidates) {
    const fullPath = join(root, filename)
    if (existsSync(fullPath)) {
      try {
        const content = JSON.parse(readFileSync(fullPath, 'utf-8'))
        const list    = Array.isArray(content) ? content : (content.categories || [])
        console.log(`[Scanner] ✓ Baca ${filename}: ${list.length} kategori`)
        return list.filter(c => c && typeof c === 'string').map(c => c.trim())
      } catch (e) {
        console.warn(`[Scanner] Gagal parse ${filename}:`, e.message)
        return []
      }
    }
  }

  console.warn(`[Scanner] ✗ Tidak ada categories JSON untuk "${prefix}${suffix}" di ${root}`)
  return []
}

// ─────────────────────────────────────────────────────────────
// MAIN SCANNER
// ─────────────────────────────────────────────────────────────
export async function scanAssets(customRoot, onLog = () => {}) {
  if (!customRoot) throw new Error('customRoot wajib diisi — set path di Settings')
  if (!existsSync(customRoot)) throw new Error(`Folder tidak ditemukan: ${customRoot}`)

  const log = (msg) => { console.log(msg); onLog(msg) }

  log(`Mulai scan: ${customRoot}`)
  clearAll()

  try {
    const styleNames  = readStyleNames(customRoot)
    const styleGroups = {}

    for (const entry of readdirSync(customRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const match = entry.name.match(FOLDER_REGEX)
      if (!match) continue
      const prefix = match[1].toLowerCase()
      const suffix = match[2] || ''
      if (!styleGroups[suffix]) styleGroups[suffix] = {}
      styleGroups[suffix][prefix] = join(customRoot, entry.name)
    }

    const stats    = { styles: 0, categories: 0, assets: 0, skipped: 0, errors: [] }
    const suffixes = Object.keys(styleGroups).sort((a, b) => Number(a || 0) - Number(b || 0))

    log(`Ditemukan ${suffixes.length} style group: [${suffixes.map(s => s || '(no suffix)').join(', ')}]`)

    for (const suffix of suffixes) {
      const styleFolders = styleGroups[suffix]
      const styleId      = Number(suffix) || 0
      const styleNameObj = styleNames[String(suffix)] ?? styleNames[String(styleId)]
      const displayName  = styleNameObj?.name        || null
      const description  = styleNameObj?.description || null

      insertStyle(styleId, displayName, description)
      stats.styles++

      log(`Style ${styleId}: "${displayName || '-'}"`)

      for (const [prefix, folderPath] of Object.entries(styleFolders)) {
        const type = FOLDER_TYPE_MAP[prefix]
        if (!type) continue

        const styleTypeId = insertStyleType(styleId, type, folderPath)

        let categoryNames = readCategoriesForFolder(customRoot, prefix, suffix)
        if (categoryNames.length === 0) {
          categoryNames = collectCategoriesFromFolder(folderPath)
          log(`  [${prefix}] Fallback scan kategori: ${categoryNames.length} ditemukan`)
        }

        const categoryIdMap   = {}
        const categoryNormMap = {}

        for (const catName of categoryNames) {
          const catId = insertCategory(styleTypeId, catName)
          categoryIdMap[catName]              = catId
          categoryNormMap[normalize(catName)] = catId
          stats.categories++
        }

        log(`  [${prefix}${suffix}] ${Object.keys(categoryIdMap).length} kategori`)

        const assetCount = scanFolderAssets(folderPath, categoryIdMap, categoryNormMap, styleTypeId, stats, log)
        log(`  [${prefix}${suffix}] ${assetCount} aset di-assign`)
      }
    }

    saveDb()

    log(`Selesai — Styles: ${stats.styles} | Kategori: ${stats.categories} | Aset: ${stats.assets} | Skip: ${stats.skipped}`)
    if (stats.errors.length > 0) {
      log(`${stats.errors.length} kategori tidak cocok (masuk Uncategorized)`)
    }

    return stats
  } catch (err) {
    log(`❌ Scan gagal: ${err.message}`)
    log(`Memulihkan database dari backup...`)
    const restored = reloadFromDisk()
    if (restored) {
      log(`✓ Database dipulihkan dari disk`)
    } else {
      log(`⚠ Tidak ada backup disk, database dalam kondisi kosong`)
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// SCAN ASET DI DALAM FOLDER
// ─────────────────────────────────────────────────────────────
function scanFolderAssets(folderPath, categoryIdMap, categoryNormMap, styleTypeId, stats, log = () => {}) {
  let files = []
  try {
    files = readdirSync(folderPath, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name)
  } catch (e) {
    stats.errors.push(`Gagal baca folder: ${folderPath}`)
    return 0
  }

  const assetMap = {}

  for (const file of files) {
    const { name, ext } = parse(file)
    const extLower      = ext.toLowerCase()
    const nameLower     = name.toLowerCase()

    // Skip file kategori
    if (nameLower.startsWith('categories')) continue

    // File RAG: `rag_nameaset.json`
    if (nameLower.startsWith('rag_')) {
      const base = nameLower.slice(4)
      if (!assetMap[base]) assetMap[base] = {}
      assetMap[base].rag = join(folderPath, file)
      continue
    }

    if (!assetMap[nameLower]) assetMap[nameLower] = {}

    // Video → mp4 field. Image → thumbnail field.
    // Kept separate so AssetCard can always prefer video over static image.
    if (['.mp4', '.webm'].includes(extLower))
      assetMap[nameLower].mp4       = join(folderPath, file)
    if (['.gif', '.jpeg', '.jpg', '.png', '.webp', '.bmp'].includes(extLower))
      assetMap[nameLower].thumbnail = join(folderPath, file)
    if (['.blend', '.fla'].includes(extLower))
      assetMap[nameLower].raw       = join(folderPath, file)
    if (extLower === '.json')
      assetMap[nameLower].json      = join(folderPath, file)
  }

  let count = 0

  for (const [assetName, assetFiles] of Object.entries(assetMap)) {
    if (!assetFiles.mp4 && !assetFiles.raw && !assetFiles.json) continue

    let category = null
    let detail   = null
    let fileName = assetName
    let fullMeta = {}  // ← simpan seluruh JSON untuk FTS

    // Baca metadata dari JSON
    if (assetFiles.json) {
      try {
        fullMeta = JSON.parse(readFileSync(assetFiles.json, 'utf-8'))
        category = fullMeta.Category || fullMeta.category || null
        detail   = fullMeta.Detail   || fullMeta.detail   || null
        fileName = fullMeta.FileName || fullMeta.fileName  || assetName
      } catch (e) {
        stats.errors.push(`Gagal parse JSON: ${assetFiles.json}`)
      }
    }

    // ── Matching kategori — 3 level ──────────────────────────
    let categoryId = resolveCategory(
      category, assetName, categoryIdMap, categoryNormMap, stats
    )

    if (!categoryId) {
      // Masukkan ke Uncategorized — buat jika belum ada
      if (!categoryIdMap['__uncategorized__']) {
        const uncatId = insertCategory(styleTypeId, '⚠ Uncategorized')
        categoryIdMap['__uncategorized__'] = uncatId
        log(`  ⚠ Uncategorized dibuat (id=${uncatId})`)
      }
      categoryId = categoryIdMap['__uncategorized__']
      log(`  ⚠ "${fileName}" → Uncategorized (Category="${category}")`)
    }

    const assetId = insertAsset({
      categoryId,
      name:          fileName,
      detail,
      rawPath:       assetFiles.raw       || null,
      mp4Path:       assetFiles.mp4       || null,
      thumbnailPath: assetFiles.thumbnail || null,
      jsonPath:      assetFiles.json      || null,
      ragJsonPath:   assetFiles.rag       || null,
    })

    // ── Populate FTS index ────────────────────────────────────
    if (assetId) {
      try {
        insertAssetFts(assetId, styleTypeId, fullMeta)
      } catch (e) {
        // FTS error tidak boleh stop scan
        stats.errors.push(`FTS insert gagal untuk ${fileName}: ${e.message}`)
      }
    }

    stats.assets++
    count++
  }

  return count
}

// ─────────────────────────────────────────────────────────────
// RESOLVE CATEGORY — 4 level matching
// ─────────────────────────────────────────────────────────────
function resolveCategory(category, assetName, categoryIdMap, categoryNormMap, stats) {
  // Level 1: exact match dari meta.Category
  if (category) {
    if (categoryIdMap[category] !== undefined) {
      return categoryIdMap[category]
    }

    // Level 2: case-insensitive exact
    const ciMatch = Object.keys(categoryIdMap)
      .find(k => k.toLowerCase() === category.toLowerCase())
    if (ciMatch) return categoryIdMap[ciMatch]

    // Level 3: normalized fuzzy (strip non-alphanumeric)
    const normCategory = normalize(category)
    if (normCategory && categoryNormMap[normCategory] !== undefined) {
      return categoryNormMap[normCategory]
    }

    // Log: category ada di JSON tapi tidak cocok sama sekali
    stats.errors.push(
      `"${assetName}" — Category="${category}" tidak cocok dengan kategori manapun`
    )
  } else {
    // Tidak ada Category di JSON atau tidak ada JSON
    stats.errors.push(
      `"${assetName}" — tidak ada field Category di JSON (atau JSON tidak ada)`
    )
  }

  // Tidak cocok → return null → masuk Uncategorized
  return null
}

// ─────────────────────────────────────────────────────────────
// FALLBACK: kumpulkan kategori dari field Category di JSON aset
// ─────────────────────────────────────────────────────────────
function collectCategoriesFromFolder(folderPath) {
  const categories = new Set()
  try {
    readdirSync(folderPath, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
      .filter(e => !e.name.toLowerCase().startsWith('categories'))
      .filter(e => !e.name.toLowerCase().startsWith('rag_'))
      .forEach(e => {
        try {
          const meta = JSON.parse(readFileSync(join(folderPath, e.name), 'utf-8'))
          if (meta.Category) categories.add(meta.Category)
        } catch (_) {}
      })
  } catch (_) {}
  return [...categories].sort()
}