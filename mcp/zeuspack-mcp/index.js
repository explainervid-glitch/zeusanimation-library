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
import { join } from 'path'
import { homedir } from 'os'
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

async function call(name, ...args) {
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
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    // Stale token file from a crashed run looks identical to "not running";
    // drop it so the next call re-reads a fresh one.
    bridge = null
    throw new Error(`Cannot reach ZeusPack: ${err.message}. Is the app running?`)
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    if (res.status === 401) bridge = null // token rotated on app restart
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

const server = new McpServer(
  { name: 'zeuspack', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

// ─── STATUS & PACKS ───────────────────────────────────────────
server.registerTool(
  'zeuspack_status',
  {
    title: 'ZeusPack status',
    description:
      'Health check: confirms ZeusPack is running and reports the active pack, ' +
      'all configured asset paths, and whether the tagger (:8000) and RAG (:8001) ' +
      'servers are reachable. Call this first when anything else fails.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  tool(async () => {
    const settings = await call('get-settings')
    const [tagger, rag] = await Promise.all([
      call('tagger-ping').catch((e) => ({ error: e.message })),
      call('rag-ping').catch((e) => ({ error: e.message })),
    ])
    const idx = settings?.activePathIndex ?? 0
    return {
      running: true,
      activePack: settings?.assetPaths?.[idx] ?? null,
      activePackIndex: idx,
      packs: settings?.assetPaths ?? [],
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
      'Full hierarchy of the active pack: style types (image/background/movement/inspiration) ' +
      'with their styles and categories, including asset counts. Use this to orient before ' +
      'drilling into a category. Can be large on big packs.',
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
      'Run the vision tagger over an asset\'s thumbnail and write the generated tags to its JSON. ' +
      'Applies the style\'s tagger hint automatically. Needs the tagger server on :8000. ' +
      'Slow — expect several seconds per asset.',
    inputSchema: {
      thumbnailPath: z.string().describe('Absolute path to the asset thumbnail/preview image'),
      assetType: z.string().describe('One of: image, background, movement, inspiration'),
      jsonPath: z.string().describe('Absolute json_path to write the tags into'),
    },
    annotations: { readOnlyHint: false },
  },
  tool((a) => call('tagger-generate', a))
)

server.registerTool(
  'delete_asset',
  {
    title: 'Delete an asset',
    description:
      'Permanently remove an asset: its DB row, its files on disk, and its RAG vector. ' +
      'Not undoable — confirm with the user before calling.',
    inputSchema: { assetId: z.number().int().describe('Asset id to delete') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  tool(({ assetId }) => call('delete-asset', { assetId }))
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

// ─── CATEGORIES ───────────────────────────────────────────────
server.registerTool(
  'add_category',
  {
    title: 'Add a category',
    description: 'Create a category folder under a style + asset type, and register it in the DB.',
    inputSchema: {
      styleSuffix: z.string().describe('Style suffix, e.g. "0", "1"'),
      assetType: z.string().describe('image | background | movement | inspiration'),
      categoryName: z.string(),
    },
    annotations: { readOnlyHint: false },
  },
  tool((a) => call('add-category', a))
)

server.registerTool(
  'delete_category',
  {
    title: 'Delete a category',
    description:
      'Delete a category, its folder, and every asset inside it. Not undoable — confirm with ' +
      'the user, and check the asset count with list_assets first.',
    inputSchema: {
      styleSuffix: z.string(),
      assetType: z.string(),
      categoryName: z.string(),
      categoryId: z.number().int(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  tool((a) => call('delete-category', a))
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
