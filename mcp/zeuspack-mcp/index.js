#!/usr/bin/env node
// ─── ZEUSPACK MCP SERVER ──────────────────────────────────────
// Bridges an MCP client (Claude Code, Claude Desktop) to a running ZeusPack
// instance. All work happens over the loopback control bridge in
// src/main/bridge/index.js, which dispatches to the app's own IPC handlers —
// so anything this server does is exactly what the UI would have done.
//
// ZeusPack must be running. There is no direct-DB fallback: the library DB is
// sql.js and lives in the main process's memory, so reading _zeuspack.db from
// disk while the app is open would serve stale data.

import { readFileSync, existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { join, resolve, extname, sep } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ─── BRIDGE CLIENT ────────────────────────────────────────────
function tokenFilePath() {
  if (process.env.ZEUSPACK_BRIDGE_FILE) return process.env.ZEUSPACK_BRIDGE_FILE
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config'))
  return join(appData, 'zeusanimation-library', 'mcp-bridge.json')
}

let bridge = null

// Handler errors are not always strings — a FastAPI `detail` can be an object or
// a list of validation errors, which would otherwise reach the model as
// "[object Object]". Keep whatever detail exists, readable.
function reason(err) {
  if (err == null) return null
  if (typeof err === 'string') return err
  return err.message ?? JSON.stringify(err)
}

function loadBridge() {
  const file = tokenFilePath()
  if (!existsSync(file)) {
    throw new Error(
      `ZeusPack does not appear to be running — no bridge file at ${file}. ` +
        `Start the app, then retry.`
    )
  }
  bridge = JSON.parse(readFileSync(file, 'utf-8'))
  return bridge
}

// The token rotates on every app start, and a crashed run leaves a stale bridge
// file behind. Either way the first call fails with a cached bridge that is now
// wrong — re-read the file and try once more so restarting ZeusPack never needs
// a retry from the model.
class StaleBridge extends Error {}

async function call(name, ...args) {
  const hadBridge = !!bridge
  try {
    return await attempt(name, args)
  } catch (err) {
    if (!(err instanceof StaleBridge) || !hadBridge) throw err
    return attempt(name, args)
  }
}

async function attempt(name, args) {
  if (!bridge) loadBridge()

  let res
  try {
    res = await fetch(`http://${bridge.host}:${bridge.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': bridge.token,
      },
      body: JSON.stringify({ name, args }),
      // Video tagging, rescan and reindex_rag legitimately run for minutes on a
      // big pack; a shorter cap would abort work the app is still doing.
      signal: AbortSignal.timeout(600_000),
    })
  } catch (err) {
    // Stale token file from a crashed run looks identical to "not running";
    // drop it so the next call re-reads a fresh one.
    bridge = null
    // A timeout means the app took the command and is still working on it —
    // retrying would run it twice.
    const Err = err.name === 'TimeoutError' ? Error : StaleBridge
    throw new Err(`Cannot reach ZeusPack: ${err.message}. Is the app running?`)
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    if (res.status === 401) {
      bridge = null // token rotated on app restart
      throw new StaleBridge(reason(body.error) ?? 'Bridge token rejected')
    }
    throw new Error(reason(body.error) ?? `Bridge returned ${res.status}`)
  }

  // Handlers return their own { success, data|error } envelope inside data.
  const inner = body.data
  if (inner && typeof inner === 'object' && inner.success === false) {
    throw new Error(reason(inner.error) ?? 'Command failed')
  }
  return inner && typeof inner === 'object' && 'data' in inner ? inner.data : inner
}

// ─── OUTPUT ───────────────────────────────────────────────────
const ok = (value) => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
})

// Wraps a tool body so a thrown error becomes a tool-level error result the
// model can read and react to, instead of a protocol fault.
const tool = (fn) => async (args) => {
  try {
    return ok(await fn(args))
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
}

// ─── ASSET TYPES ──────────────────────────────────────────────
// The app names the same four types two ways: the DB, asset tree and tagger
// say character|animation, while the on-disk folders (and so create-asset /
// add-category / add-style) say image|movement. Tools speak only the tree's
// vocabulary and translate here, so the model never has to know there are two.
const ASSET_TYPES = ['background', 'character', 'animation', 'inspiration']
const FOLDER_PREFIX = {
  background: 'background',
  character: 'image',
  animation: 'movement',
  inspiration: 'inspiration',
}
const assetTypeSchema = z
  .enum(ASSET_TYPES)
  .describe('Type as shown in get_asset_tree: background | character | animation | inspiration')

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi']
const isVideo = (p) => !!p && VIDEO_EXTS.some((e) => p.toLowerCase().endsWith(e))

const server = new McpServer(
  { name: 'zeuspack', version: '1.2.0' },
  { capabilities: { tools: {} } }
)

// ─── STATUS & PACKS ───────────────────────────────────────────
server.registerTool(
  'zeuspack_status',
  {
    title: 'ZeusPack status',
    description:
      'Health check: confirms ZeusPack is running and reports the active pack, ' +
      'all configured asset paths, the template ids create_asset can use, and whether ' +
      'the tagger (:8000) and RAG (:8001) servers are reachable. Call this first, and ' +
      'whenever anything else fails.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  tool(async () => {
    const settings = await call('get-settings')
    // A ping that fails returns { success: false } with no error text, which
    // call() turns into a bare "Command failed" — report reachability instead.
    const ping = (cmd, url) =>
      call(cmd).then(
        () => ({ reachable: true, url }),
        () => ({ reachable: false, url })
      )
    const [tagger, rag] = await Promise.all([
      ping('tagger-ping', settings?.taggerUrl),
      ping('rag-ping', settings?.ragUrl),
    ])
    const idx = settings?.activePathIndex ?? 0
    return {
      running: true,
      activePack: settings?.assetPaths?.[idx] ?? null,
      activePackIndex: idx,
      packs: settings?.assetPaths ?? [],
      templates: (settings?.templatePaths ?? []).map((t) => ({ id: t.id, path: t.path })),
      taggerServer: tagger,
      ragServer: rag,
    }
  })
)

server.registerTool(
  'switch_pack',
  {
    title: 'Switch active pack',
    description:
      'Switch which asset pack is active, by index into the list from zeuspack_status. ' +
      'Opens that pack\'s database without rescanning. The UI follows along.',
    inputSchema: { packIndex: z.number().int().min(0).describe('Index from zeuspack_status.packs') },
    annotations: { readOnlyHint: false },
  },
  tool(({ packIndex }) => call('switch-pack', packIndex))
)

// ─── BROWSE ───────────────────────────────────────────────────
server.registerTool(
  'get_asset_tree',
  {
    title: 'Get asset tree',
    description:
      'Full hierarchy of the active pack: styles (top-level id = styleId) → types ' +
      '(background / character / animation / inspiration, id = styleTypeId) → categories ' +
      'with asset counts. Use this to orient before drilling into a category, and to get ' +
      'the ids every other tool takes. Can be large on big packs.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  tool(() => call('get-asset-tree'))
)

server.registerTool(
  'list_categories',
  {
    title: 'List categories',
    description: 'All categories belonging to one style type. Get styleTypeId from get_asset_tree.',
    inputSchema: { styleTypeId: z.number().int().describe('Style type id from get_asset_tree') },
    annotations: { readOnlyHint: true },
  },
  tool(({ styleTypeId }) => call('get-type-categories', styleTypeId))
)

server.registerTool(
  'list_assets',
  {
    title: 'List assets',
    description:
      'List assets in one category, or across every category of a style type. ' +
      'Pass exactly one of categoryId or styleTypeId.',
    inputSchema: {
      categoryId: z.number().int().optional().describe('List assets in this category'),
      styleTypeId: z.number().int().optional().describe('List all assets of this style type'),
    },
    annotations: { readOnlyHint: true },
  },
  tool(({ categoryId, styleTypeId }) => {
    if ((categoryId == null) === (styleTypeId == null)) {
      throw new Error('Pass exactly one of categoryId or styleTypeId')
    }
    return categoryId != null
      ? call('get-assets-by-category', categoryId)
      : call('get-assets-by-style-type', styleTypeId)
  })
)

// ─── SEARCH ───────────────────────────────────────────────────
server.registerTool(
  'search_assets',
  {
    title: 'Keyword search',
    description:
      'Full-text (SQLite FTS) keyword search over asset metadata within one style type. ' +
      'Fast and literal — use it when you know the words that appear in the tags. ' +
      'For meaning-based queries use semantic_search instead.',
    inputSchema: {
      styleTypeId: z.number().int().describe('Style type to search within'),
      query: z.string().describe('Keyword query, e.g. "running loop" or "night sky"'),
    },
    annotations: { readOnlyHint: true },
  },
  tool(({ styleTypeId, query }) => call('search-assets', { styleTypeId, query }))
)

server.registerTool(
  'semantic_search',
  {
    title: 'Semantic search (RAG)',
    description:
      'Vector search over the RAG index — matches by meaning rather than exact words, ' +
      'so "someone looking sad" can find assets tagged "dejected", "head down". ' +
      'Always scoped to a single style: pass styleId (the top-level id in get_asset_tree, ' +
      'or a key from list_styles). Requires the RAG server on :8001 (see zeuspack_status). ' +
      'If results are empty across styles, the index may need reindex_rag.',
    inputSchema: {
      query: z.string().describe('Natural-language description of what you want'),
      styleId: z.number().int().describe('Style to search within — required, results never span styles'),
      limit: z.number().int().min(1).max(100).default(10),
    },
    annotations: { readOnlyHint: true },
  },
  tool(({ query, styleId, limit }) => call('rag-search', { query, styleId, limit }))
)

// ─── ASSET READ / WRITE ───────────────────────────────────────
server.registerTool(
  'read_asset',
  {
    title: 'Read asset metadata',
    description:
      'Read one asset\'s JSON metadata (tags, description, and other fields) from its json_path, ' +
      'which appears in list_assets and search results.',
    inputSchema: { jsonPath: z.string().describe('Absolute json_path from a listing or search') },
    annotations: { readOnlyHint: true },
  },
  tool(({ jsonPath }) => call('read-asset-json', jsonPath))
)

server.registerTool(
  'write_asset',
  {
    title: 'Write asset metadata',
    description:
      'Overwrite an asset\'s JSON metadata and sync the search index. The data object REPLACES ' +
      'the file wholesale, so read_asset first and send back the merged result — never a partial ' +
      'object, or you will drop fields.',
    inputSchema: {
      jsonPath: z.string().describe('Absolute json_path of the asset'),
      assetId: z.number().int().describe('Asset id, so the DB/FTS row updates too'),
      data: z.record(z.string(), z.any()).describe('Complete replacement metadata object'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  tool(({ jsonPath, assetId, data }) => call('write-asset-json', { jsonPath, assetId, data }))
)

server.registerTool(
  'auto_tag',
  {
    title: 'AI auto-tag an asset',
    description:
      'Run the AI tagger on one asset and save the result. Animation assets go through the ' +
      'video tagger (needs an mp4/mov/webm preview); every other type goes through the image ' +
      'tagger (needs a thumbnail or preview). The tagger merges its tags into the existing JSON ' +
      '— protected fields like FileName are kept — and the keyword index is then synced, ' +
      'exactly like the app\'s batch tagger. Applies the style\'s tagger hint automatically. ' +
      'Pass the asset fields straight from list_assets. Slow: seconds per image, longer for ' +
      'video. semantic_search only reflects new tags after reindex_rag.',
    inputSchema: {
      assetId: z.number().int().describe('id from list_assets'),
      assetType: assetTypeSchema,
      name: z.string().describe('name from list_assets'),
      jsonPath: z.string().optional().describe('json_path from list_assets (may be empty)'),
      thumbnailPath: z.string().optional().describe('thumbnail_path from list_assets'),
      mp4Path: z.string().optional().describe('mp4_path from list_assets'),
      rawPath: z.string().optional().describe('raw_path from list_assets'),
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  tool(async ({ assetId, assetType, name, jsonPath = '', thumbnailPath, mp4Path, rawPath }) => {
    // Same source-file choice as runBatch in useBatchStore.js.
    let tags
    if (assetType === 'animation') {
      const videoPath = isVideo(mp4Path) ? mp4Path : isVideo(rawPath) ? rawPath : null
      if (!videoPath) throw new Error('No mp4 preview found for this animation asset')
      tags = await call('tagger-generate-video', { videoPath, jsonPath, filename: name })
    } else {
      const previewPath = thumbnailPath || mp4Path || rawPath
      if (!previewPath) throw new Error('No preview image found for this asset')
      tags = await call('tagger-generate', { thumbnailPath: previewPath, assetType, jsonPath })
    }

    // The tagger writes the merged JSON to disk itself but never touches the
    // app's DB. Writing it back through write-asset-json updates name, detail,
    // category and the FTS row — what the UI's Save All does after a batch.
    const saved = await call('write-asset-json', { jsonPath, assetId, data: tags })
    return { assetId, jsonPath: saved?.jsonPath ?? jsonPath, tags }
  })
)

// ─── VIEW PREVIEW ─────────────────────────────────────────────
// Listings only carry file paths, which a client like Claude Desktop cannot
// open. This returns the preview itself as MCP image content, so any
// vision-capable client can look at an asset and write tags from what it sees.
const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
// Clients reject large image blocks; pack thumbnails are ~10–30 KB, so anything
// past this is a raw render and gets downscaled through ffmpeg instead.
const MAX_IMAGE_BYTES = 750 * 1024
const FFMPEG = process.env.ZEUSPACK_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.ZEUSPACK_FFPROBE || 'ffprobe'
const run = promisify(execFile)

// Only files inside a configured pack are readable. Without this the tool would
// hand the model any image on the machine.
async function assertInsidePack(file) {
  const settings = await call('get-settings')
  const norm = (p) => resolve(p).toLowerCase()
  const target = norm(file)
  const inside = (settings?.assetPaths ?? []).some(({ path }) => {
    if (!path?.trim()) return false
    const root = norm(path)
    return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
  })
  if (!inside) throw new Error(`Not inside any configured asset pack: ${file}`)
}

async function ffmpegJpeg(args) {
  try {
    const { stdout } = await run(FFMPEG, ['-v', 'error', ...args, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    // A dangling PATH entry (e.g. a winget link whose target moved) can exit
    // cleanly with nothing on stdout — never hand the model an empty image.
    if (!stdout?.length) throw Object.assign(new Error('no output'), { code: 'ENOENT' })
    return stdout
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('ffmpeg not found on PATH — install it or set ZEUSPACK_FFMPEG to its full path')
    }
    throw new Error(`ffmpeg failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

async function videoDuration(file) {
  try {
    const { stdout } = await run(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { windowsHide: true }
    )
    const d = parseFloat(stdout)
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

server.registerTool(
  'view_preview',
  {
    title: 'View asset preview',
    description:
      'Return an asset\'s preview as an image you can look at — use it to describe, tag or ' +
      'rename assets from what they actually show. Pass thumbnail_path (images) or mp4_path ' +
      '(animations) from list_assets. Videos come back as one contact-sheet image of evenly ' +
      'spaced frames, left-to-right then top-to-bottom in time order. Only files inside a ' +
      'configured asset pack can be viewed. Video needs ffmpeg on PATH.',
    inputSchema: {
      path: z.string().describe('thumbnail_path, mp4_path or raw_path from list_assets'),
      frames: z
        .number()
        .int()
        .min(1)
        .max(16)
        .default(6)
        .describe('Video only: how many frames to sample into the contact sheet'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ path, frames }) => {
    try {
      await assertInsidePack(path)
      const ext = extname(path).toLowerCase()
      let data
      let mimeType = 'image/jpeg'
      let note

      if (VIDEO_EXTS.includes(ext)) {
        const duration = await videoDuration(path)
        const cols = Math.ceil(Math.sqrt(frames))
        const rows = Math.ceil(frames / cols)
        // fps=N/duration spreads N samples across the clip; tile packs them into
        // one image so a single block covers the whole motion.
        const sample = duration ? `fps=${frames}/${duration.toFixed(3)}` : 'thumbnail'
        const tile = duration ? `,tile=${cols}x${rows}` : ''
        data = await ffmpegJpeg(['-i', path, '-vf', `${sample},scale=320:-2${tile}`, '-frames:v', '1'])
        note = duration
          ? `${frames} frames over ${duration.toFixed(2)}s, ${cols}x${rows} grid, time runs left-to-right, top-to-bottom`
          : 'duration unknown — single representative frame'
      } else if (IMAGE_MIME[ext]) {
        const { size } = await stat(path)
        if (size <= MAX_IMAGE_BYTES) {
          data = await readFile(path)
          mimeType = IMAGE_MIME[ext]
        } else {
          data = await ffmpegJpeg(['-i', path, '-vf', 'scale=1024:-2', '-frames:v', '1'])
          note = `downscaled from ${Math.round(size / 1024)} KB`
        }
      } else {
        throw new Error(`Not a previewable image or video: ${ext || 'no extension'}`)
      }

      const content = [{ type: 'image', data: data.toString('base64'), mimeType }]
      if (note) content.push({ type: 'text', text: note })
      return { content }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }
)

server.registerTool(
  'set_asset_preview',
  {
    title: 'Set asset preview',
    description: 'Point an asset at a different preview/thumbnail image.',
    inputSchema: {
      assetId: z.number().int(),
      previewPath: z.string().describe('Absolute path to the new preview image'),
    },
    annotations: { readOnlyHint: false },
  },
  tool((a) => call('set-asset-preview', a))
)

// ─── STYLES ───────────────────────────────────────────────────
server.registerTool(
  'list_styles',
  {
    title: 'List styles',
    description:
      'Style names, descriptions, and per-style tagger hints for a pack, read from stylenames.json.',
    inputSchema: { packIndex: z.number().int().optional().describe('Defaults to the active pack') },
    annotations: { readOnlyHint: true },
  },
  tool(({ packIndex }) => call('get-style-names', { packIndex }))
)

server.registerTool(
  'rename_style',
  {
    title: 'Rename a style',
    description: 'Change a style\'s display name and/or description.',
    inputSchema: {
      styleId: z.number().int(),
      newName: z.string(),
      newDescription: z.string().optional(),
    },
    annotations: { readOnlyHint: false },
  },
  tool((a) => call('rename-style', a))
)

server.registerTool(
  'set_style_hints',
  {
    title: 'Set tagger hints',
    description:
      'Set per-style tagger hints — extra context handed to the vision model when tagging assets ' +
      'in that style. Keyed by style suffix ("0", "1", ...). This REPLACES the hints map, so ' +
      'read list_styles first and send the merged result.',
    inputSchema: {
      hints: z.record(z.string(), z.any()).describe('Full hints map, keyed by style suffix'),
      packIndex: z.number().int().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  tool((a) => call('set-style-hints', a))
)

server.registerTool(
  'generate_style_guide',
  {
    title: 'Generate a style guide',
    description:
      'Sample assets from a style and have the AI infer a style guide / tagger hint describing it. ' +
      'Useful before bulk-tagging a new style.',
    inputSchema: {
      suffix: z.string().describe('Style suffix, e.g. "0", "1"'),
      packIndex: z.number().int().optional(),
      sampleSize: z.number().int().min(1).max(20).default(5),
    },
    annotations: { readOnlyHint: false },
  },
  tool((a) => call('generate-style-guide', a))
)

// ─── CREATE ───────────────────────────────────────────────────
// Delete is disabled for now: no tool here removes an asset, category or style,
// and the bridge allowlist refuses the delete commands even if called directly.
server.registerTool(
  'create_style',
  {
    title: 'Create a style',
    description:
      'Add a new style to the active pack. Takes the next free style number from disk, creates ' +
      'one folder per chosen type, and registers it in the DB and stylenames.json. Optionally ' +
      'clone the category lists from an existing style — otherwise the new style starts with no ' +
      'categories and every asset added to it lands in ⚠ Uncategorized.',
    inputSchema: {
      name: z.string().describe('Display name, e.g. "Style 4"'),
      description: z.string().optional(),
      types: z
        .array(z.enum(ASSET_TYPES))
        .optional()
        .describe('Types to create folders for. Defaults to all four.'),
      copyCategoriesFromStyleId: z
        .number()
        .int()
        .optional()
        .describe('styleId whose category lists to copy (recommended)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  tool(({ name, description, types, copyCategoriesFromStyleId }) =>
    call('add-style', {
      name,
      description,
      types: types?.map((t) => FOLDER_PREFIX[t]),
      copyFromSuffix: copyCategoriesFromStyleId ?? null,
    })
  )
)

server.registerTool(
  'add_category',
  {
    title: 'Add a category',
    description:
      'Add a category to one type within a style and register it in the DB. Required before ' +
      'create_asset can put an asset there.',
    inputSchema: {
      styleId: z.number().int().describe('Top-level style id from get_asset_tree'),
      assetType: assetTypeSchema,
      categoryName: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  tool(({ styleId, assetType, categoryName }) =>
    call('add-category', {
      styleSuffix: String(styleId),
      assetType: FOLDER_PREFIX[assetType],
      categoryName,
    })
  )
)

server.registerTool(
  'create_asset',
  {
    title: 'Create a new asset',
    description:
      'Create a new asset from the pack\'s template: copies the template file (Animate/Blender ' +
      'per pack and type, or another id from zeuspack_status.templates such as "ae") into the ' +
      'style\'s folder as <fileName>.<ext>, writes a starter JSON {FileName, Detail, Category}, ' +
      'and registers it in the DB and keyword index. The category must already exist ' +
      '(add_category). Refuses to overwrite: an existing name returns an error. ' +
      'The new asset has no preview yet, so auto_tag will not work on it until one is added — ' +
      'fill its metadata with write_asset instead (find its id via list_assets).',
    inputSchema: {
      styleId: z.number().int().describe('Top-level style id from get_asset_tree'),
      assetType: assetTypeSchema,
      categoryName: z.string().describe('Existing category within that style + type'),
      fileName: z.string().describe('File name without extension, e.g. "Agree7"'),
      detail: z.string().optional().describe('Short one-line description'),
      templateId: z
        .string()
        .optional()
        .describe('Override the template, e.g. "ae" for After Effects. Usually omit.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  tool(({ styleId, assetType, categoryName, fileName, detail, templateId }) =>
    call('create-asset', {
      styleSuffix: String(styleId),
      assetType: FOLDER_PREFIX[assetType],
      categoryName,
      fileName,
      detail,
      templateId,
    })
  )
)

// ─── MAINTENANCE ──────────────────────────────────────────────
server.registerTool(
  'rescan',
  {
    title: 'Rescan the pack',
    description:
      'Re-walk the active pack from disk and rebuild the database. Use after files change ' +
      'outside the app. Slow on large packs.',
    inputSchema: {},
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  tool(() => call('rescan-assets'))
)

server.registerTool(
  'reindex_rag',
  {
    title: 'Rebuild the RAG index',
    description:
      'Clear and re-embed every asset in the active pack into the vector index. Fixes stale or ' +
      'empty semantic_search results after bulk metadata edits. Slow — minutes on a large pack.',
    inputSchema: {},
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  tool(() => call('rag-index-bulk'))
)

await server.connect(new StdioServerTransport())
console.error('[zeuspack-mcp] ready')
