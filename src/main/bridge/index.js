// ─── MCP CONTROL BRIDGE ───────────────────────────────────────
// Exposes the app's existing IPC commands over a loopback HTTP server so an
// external MCP server can drive ZeusPack the same way the renderer does.
//
// Mirrors the pattern zeuspack_bridge.py uses on the Blender side, inverted:
// there Blender hosts and we call in; here we host and the MCP server calls in.
//
// Handlers are captured by wrapping ipcMain.handle rather than restructuring
// ipc/assets.js — the renderer path is untouched and both transports run the
// exact same function, so they can never drift.

import { createServer } from 'http'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { app, ipcMain, BrowserWindow } from 'electron'

const HOST = '127.0.0.1'
const PORT = 8765

// Commands the bridge may dispatch. Scope: read + write assets.
// Deliberately excluded:
//   send-to-project / create-project / delete-project-file — touch the user's
//     project folders, outside the library itself
//   select-folder / select-file — open a modal dialog, would hang a headless call
//   save-settings — app configuration, not asset data
//   blender-* — the Blender MCP already covers that surface directly
//   open-asset-file / open-path — spawn external programs on the user's desktop
const ALLOWED = new Set([
  // read
  'get-asset-tree',
  'get-assets-by-category',
  'get-assets-by-style-type',
  'get-type-categories',
  'get-settings',
  'get-style-names',
  'read-asset-json',
  'search-assets',
  'rag-search',
  'check-db-updated',
  'scan-preview-file',
  'tagger-ping',
  'tagger-ping-video',
  'rag-ping',
  // write
  'write-asset-json',
  'rescan-assets',
  'switch-pack',
  'rename-style',
  'set-style-hints',
  'generate-style-guide',
  'add-category',
  'delete-category',
  'add-asset',
  'create-asset',
  'delete-asset',
  'set-asset-preview',
  'tagger-generate',
  'tagger-generate-video',
  'rag-index-upsert',
  'rag-index-bulk',
  'rag-index-delete',
])

const commands = new Map()
let server = null
let token = null

// ─── HANDLER CAPTURE ──────────────────────────────────────────
// Must run before registerIpcHandlers(). Wraps ipcMain.handle so every
// channel registered afterwards is also reachable from the bridge.
export function installCommandRecorder() {
  const original = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => {
    commands.set(channel, listener)
    return original(channel, listener)
  }
}

// Handlers receive an IpcMainInvokeEvent. Only rag-index-bulk actually reads
// it (event.sender, to stream embed progress to the UI), so pointing sender at
// the main window keeps that progress bar working for bridge-initiated calls.
function fakeEvent() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  return { sender: win?.webContents ?? null, frameId: 0, processId: 0 }
}

// ─── TOKEN ────────────────────────────────────────────────────
// Loopback alone doesn't authenticate — any local process could POST
// delete-category. The MCP server reads this file to get the shared secret.
function writeTokenFile() {
  token = randomBytes(24).toString('hex')
  const file = join(app.getPath('userData'), 'mcp-bridge.json')
  writeFileSync(file, JSON.stringify({ host: HOST, port: PORT, token }, null, 2))
  return file
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 8 * 1024 * 1024) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

// ─── SERVER ───────────────────────────────────────────────────
export function startBridge() {
  const tokenFile = writeTokenFile()

  server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)

    // Unauthenticated liveness check — lets the MCP server report
    // "ZeusPack not running" cleanly without holding the token.
    if (req.method === 'GET' && url.pathname === '/ping') {
      return send(res, 200, {
        ok: true,
        app: 'zeuspack',
        version: app.getVersion(),
        commands: [...commands.keys()].filter((c) => ALLOWED.has(c)).length,
      })
    }

    if (req.headers['x-bridge-token'] !== token) {
      return send(res, 401, { success: false, error: 'Invalid or missing bridge token' })
    }

    if (req.method === 'GET' && url.pathname === '/commands') {
      return send(res, 200, {
        success: true,
        data: [...commands.keys()].filter((c) => ALLOWED.has(c)).sort(),
      })
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      let body
      try {
        body = await readBody(req)
      } catch (err) {
        return send(res, 400, { success: false, error: err.message })
      }

      const { name, args = [] } = body
      if (!name) return send(res, 400, { success: false, error: 'Missing "name"' })
      if (!ALLOWED.has(name)) {
        return send(res, 403, { success: false, error: `Command not exposed to MCP: ${name}` })
      }

      const handler = commands.get(name)
      if (!handler) {
        return send(res, 404, { success: false, error: `Unknown command: ${name}` })
      }

      try {
        const result = await handler(fakeEvent(), ...(Array.isArray(args) ? args : [args]))
        return send(res, 200, { success: true, data: result })
      } catch (err) {
        console.error(`[Bridge] ${name} failed:`, err)
        return send(res, 500, { success: false, error: err.message })
      }
    }

    send(res, 404, { success: false, error: 'Not found' })
  })

  server.listen(PORT, HOST, () => {
    console.log(`[Bridge] MCP control bridge on http://${HOST}:${PORT}`)
    console.log(`[Bridge] Token written to ${tokenFile}`)
  })

  server.on('error', (err) => {
    // Port taken usually means a second ZeusPack instance. Non-fatal —
    // the app runs fine, only MCP access is unavailable.
    console.warn(`[Bridge] Could not start on ${PORT}: ${err.message}`)
    server = null
  })
}

export function stopBridge() {
  server?.close()
  server = null
  const file = join(app.getPath('userData'), 'mcp-bridge.json')
  if (existsSync(file)) {
    try {
      unlinkSync(file)
    } catch (err) {
      console.warn(`[Bridge] Could not remove token file: ${err.message}`)
    }
  }
}
