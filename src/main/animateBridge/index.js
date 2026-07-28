// ─── ADOBE ANIMATE BRIDGE ─────────────────────────────────────
// A tiny loopback HTTP server the ZeusPack CEP panel (running inside Adobe
// Animate 2024) polls. ZeusPack is the host; the panel is the client, because
// the CEP host has `fetch` but NOT Node.js — so it can't listen, only poll.
//
// Flow:
//   1. App enqueues a job  → enqueueAnimateJob(action, params) → Promise
//   2. Panel GET /poll     → receives the job (also a heartbeat)
//   3. Panel runs JSFL, POST /result { id, ok, message, data }
//   4. The Promise from step 1 resolves with that result
//
// This is the transport foundation; the Animate "Compile" flow is built on top.
import { createServer } from 'http'
import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { readFlaLibrary } from './flaLibrary.js'
import { startDialogAutoAnswer } from './dialogAuto.js'

const HOST = '127.0.0.1'
const PORT = 8770
const HEARTBEAT_STALE_MS = 4000   // panel counts as disconnected after this gap
const JOB_TIMEOUT_MS     = 30000  // give up on a job the panel never answers

let server       = null
const queue      = []            // pending jobs the panel hasn't picked up yet
const pending    = new Map()     // jobId → { resolve, reject, timer } (awaiting /result)
let lastPollAt   = 0             // last time the panel hit /poll (heartbeat)
let panelInfo    = null          // last { app, version } the panel reported

// ─── PUBLIC API ───────────────────────────────────────────────
// Queue a job for the panel and resolve when it posts the result.
// `timeoutMs` is per-job: long flows (2D compile waits on the user answering
// Animate's native conflict dialog) need far more than the default.
export function enqueueAnimateJob(action, params = {}, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      // Drop it from the queue too if never picked up.
      const i = queue.findIndex((j) => j.id === id)
      if (i >= 0) queue.splice(i, 1)
      reject(new Error('Animate did not respond (is the ZeusPack panel open in Animate?)'))
    }, Math.max(1000, timeoutMs))

    pending.set(id, { resolve, reject, timer })
    queue.push({ id, action, params, createdAt: Date.now() })
  })
}

export function animateStatus() {
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
export function startAnimateBridge() {
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
      panelInfo = { app: url.searchParams.get('app') || 'animate', version: url.searchParams.get('v') || '' }
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

  server.listen(PORT, HOST, () => console.log(`[AnimateBridge] listening on http://${HOST}:${PORT}`))
  server.on('error', (err) => {
    console.warn(`[AnimateBridge] Could not start on ${PORT}: ${err.message}`)
    server = null
  })
}

export function stopAnimateBridge() {
  server?.close()
  server = null
}

// ─── IPC (renderer ↔ bridge) ──────────────────────────────────
export function registerAnimateIpc() {
  ipcMain.handle('animate-status', async () => ({ success: true, ...animateStatus() }))
  ipcMain.handle('animate-run', async (_e, { action, params = {}, timeoutMs, autoDialog } = {}) => {
    if (!action) return { success: false, error: 'Missing action' }
    // While this job runs, optionally watch for Animate's native "Resolve
    // Library Conflict" modal and answer it with the default ("Don't replace").
    // JSFL is blocked behind that dialog, so it can only be answered from here.
    const watcher = autoDialog ? startDialogAutoAnswer() : null
    try {
      const result = await enqueueAnimateJob(action, params, timeoutMs)
      const w = watcher ? watcher.stop() : { answered: 0, lastCandidates: '' }
      return {
        success: result.ok, ...result,
        dialogsAnswered: w.answered,
        // Surfaced only when auto-answer never fired — names the windows
        // Animate actually had on screen, so we can identify the real dialog.
        dialogCandidates: w.answered ? '' : w.lastCandidates,
      }
    } catch (err) {
      watcher?.stop()
      return { success: false, error: err.message }
    }
  })

  // Read a .fla's library straight from disk (no Animate needed) — fast.
  ipcMain.handle('read-fla-library', async (_e, { flaPath } = {}) => {
    if (!flaPath) return { success: false, error: 'No .fla path provided' }
    try {
      return { success: true, ...readFlaLibrary(flaPath) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}
