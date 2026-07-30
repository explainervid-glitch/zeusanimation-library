// ─── ADOBE AFTER EFFECTS BRIDGE ───────────────────────────────
// A tiny loopback HTTP server the ZeusPack CEP panel (running inside Adobe
// After Effects) polls. Same shape as the Animate bridge: ZeusPack is the host;
// the panel is the client, because the CEP host has `fetch` but NOT Node.js —
// so it can't listen, only poll.
//
// Flow:
//   1. App enqueues a job  → enqueueAeJob(action, params) → Promise
//   2. Panel GET /poll     → receives the job (also a heartbeat)
//   3. Panel runs ExtendScript (JSX), POST /result { id, ok, message, data }
//   4. The Promise from step 1 resolves with that result
//
// Unlike .fla / .blend, an .aep is a binary project we CANNOT read off disk —
// so listing/importing compositions must go through After Effects itself
// (the `import-aep` job imports the project and reports its comp names).
import { createServer } from 'http'
import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'

const HOST = '127.0.0.1'
const PORT = 8771                 // Animate uses 8770; AE gets the next port
const HEARTBEAT_STALE_MS = 4000   // panel counts as disconnected after this gap
const JOB_TIMEOUT_MS     = 30000  // give up on a job the panel never answers

let server     = null
const queue    = []            // pending jobs the panel hasn't picked up yet
const pending  = new Map()     // jobId → { resolve, reject, timer } (awaiting /result)
let lastPollAt = 0             // last time the panel hit /poll (heartbeat)
let panelInfo  = null          // last { app, version } the panel reported

// ─── PUBLIC API ───────────────────────────────────────────────
// Queue a job for the panel and resolve when it posts the result.
export function enqueueAeJob(action, params = {}, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      const i = queue.findIndex((j) => j.id === id)
      if (i >= 0) queue.splice(i, 1)
      reject(new Error('After Effects did not respond (is the ZeusPack panel open in After Effects?)'))
    }, Math.max(1000, timeoutMs))

    pending.set(id, { resolve, reject, timer })
    queue.push({ id, action, params, createdAt: Date.now() })
  })
}

export function aeStatus() {
  const connected = Date.now() - lastPollAt < HEARTBEAT_STALE_MS
  return { connected, lastSeen: lastPollAt || null, panel: connected ? panelInfo : null, queued: queue.length }
}

// ─── HTTP HELPERS ─────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) reject(new Error('Body too large')) })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(new Error(`Invalid JSON: ${e.message}`)) } })
    req.on('error', reject)
  })
}

// ─── SERVER ───────────────────────────────────────────────────
export function startAfterEffectsBridge() {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)

    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end() }

    // Liveness check for the panel.
    if (req.method === 'GET' && url.pathname === '/ping') {
      return send(res, 200, { ok: true, app: 'zeuspack', version: app.getVersion() })
    }

    // Panel heartbeat + fetch the next job.
    if (req.method === 'GET' && url.pathname === '/poll') {
      lastPollAt = Date.now()
      panelInfo = { app: url.searchParams.get('app') || 'aftereffects', version: url.searchParams.get('v') || '' }
      const job = queue.shift() || null
      return send(res, 200, { job })
    }

    // Panel returns a finished job's result.
    if (req.method === 'POST' && url.pathname === '/result') {
      let body
      try { body = await readBody(req) } catch (e) { return send(res, 400, { ok: false, error: e.message }) }
      const { id, ok, message, data } = body
      const p = pending.get(id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(id)
        p.resolve({ ok: ok !== false, message: message || '', data: data ?? null })
      }
      return send(res, 200, { ok: true })
    }

    send(res, 404, { ok: false, error: 'Not found' })
  })

  server.listen(PORT, HOST, () => console.log(`[AeBridge] listening on http://${HOST}:${PORT}`))
  server.on('error', (err) => {
    console.warn(`[AeBridge] Could not start on ${PORT}: ${err.message}`)
    server = null
  })
}

export function stopAfterEffectsBridge() {
  server?.close()
  server = null
}

// ─── IPC (renderer ↔ bridge) ──────────────────────────────────
export function registerAfterEffectsIpc() {
  ipcMain.handle('ae-status', async () => ({ success: true, ...aeStatus() }))
  ipcMain.handle('ae-run', async (_e, { action, params = {}, timeoutMs } = {}) => {
    if (!action) return { success: false, error: 'Missing action' }
    try {
      const result = await enqueueAeJob(action, params, timeoutMs)
      return { success: result.ok, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}
