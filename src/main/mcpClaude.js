// ─── CLAUDE DESKTOP AUTO-CONNECT ──────────────────────────────
// Registers the ZeusPack MCP server in Claude Desktop's config so teammates
// never have to edit JSON by hand. Runs on every app start (and self-heals the
// entry if a release moved the launcher); the Preferences toggle turns it off,
// which removes the entry and stops it being re-added.
//
// Only our own `mcpServers.zeuspack` key is ever touched — every other server
// and setting in the file is preserved, and a config that fails to parse is
// left alone rather than overwritten.

import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs'
import { join, resolve, dirname } from 'path'

const KEY = 'zeuspack'
const CONFIG_NAME = 'claude_desktop_config.json'

function prefsFile() {
  return join(app.getPath('userData'), 'mcp-claude.json')
}

function isDisabled() {
  try {
    return JSON.parse(readFileSync(prefsFile(), 'utf-8')).disabled === true
  } catch {
    return false
  }
}

function setDisabled(disabled) {
  writeFileSync(prefsFile(), JSON.stringify({ disabled }, null, 2))
}

// Claude Desktop keeps its config in one of two places depending on how it was
// installed: the classic installer uses %APPDATA%\Claude, the Microsoft Store
// (MSIX) build a virtualised copy under its package folder. Write to every one
// whose Claude folder exists — whichever the installed build reads gets it.
function configPaths() {
  const dirs = []
  const appData = process.env.APPDATA
  const localAppData = process.env.LOCALAPPDATA
  if (appData) dirs.push(join(appData, 'Claude'))
  if (localAppData) {
    const pkgRoot = join(localAppData, 'Packages')
    try {
      for (const name of readdirSync(pkgRoot)) {
        if (name.startsWith('Claude_')) dirs.push(join(pkgRoot, name, 'LocalCache', 'Roaming', 'Claude'))
      }
    } catch {
      // no Packages folder — classic install only
    }
  }
  return dirs.filter((d) => existsSync(d)).map((d) => join(d, CONFIG_NAME))
}

// What the client should launch. Deployed builds point at the version-independent
// launcher on the share (W:\00 - ZEUSPACK\zeuspack-mcp.cmd — two levels above
// builds\<version>\zeuspack.exe), so a release never invalidates the entry. Any
// other packaged copy runs its own bundled server; dev runs the source.
function serverEntry() {
  if (!app.isPackaged) {
    return { command: 'node', args: [join(app.getAppPath(), 'mcp', 'zeuspack-mcp', 'index.js')] }
  }
  const launcher = resolve(dirname(process.execPath), '..', '..', 'zeuspack-mcp.cmd')
  if (existsSync(launcher)) return { command: 'cmd', args: ['/c', launcher] }
  return {
    command: process.execPath,
    args: [join(process.resourcesPath, 'mcp', 'zeuspack-mcp.mjs')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function readConfig(file) {
  if (!existsSync(file)) return {}
  const raw = readFileSync(file, 'utf-8')
  if (!raw.trim()) return {}
  return JSON.parse(raw) // throws on a broken file — caller must not overwrite it
}

function writeConfig(file, config) {
  if (existsSync(file)) copyFileSync(file, `${file}.zeuspack.bak`)
  writeFileSync(file, JSON.stringify(config, null, 2))
}

const sameEntry = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function claudeStatus() {
  const files = configPaths()
  const entry = serverEntry()
  let connected = false
  let upToDate = files.length > 0
  for (const file of files) {
    try {
      const current = readConfig(file).mcpServers?.[KEY]
      if (current) connected = true
      if (!sameEntry(current, entry)) upToDate = false
    } catch {
      upToDate = false
    }
  }
  return { installed: files.length > 0, connected, upToDate, enabled: !isDisabled() }
}

// Returns true when any file changed — Claude Desktop only reads its config at
// startup, so the UI tells the user to restart it.
function applyEntry(add) {
  const entry = serverEntry()
  let changed = false
  const errors = []
  for (const file of configPaths()) {
    try {
      const config = readConfig(file)
      const servers = config.mcpServers ?? {}
      if (add) {
        if (sameEntry(servers[KEY], entry)) continue
        servers[KEY] = entry
      } else {
        if (!(KEY in servers)) continue
        delete servers[KEY]
      }
      config.mcpServers = servers
      writeConfig(file, config)
      changed = true
    } catch (err) {
      errors.push(`${file}: ${err.message}`)
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return changed
}

// Startup hook: silent, never throws. Does nothing when Claude Desktop isn't
// installed or the user switched the connection off.
export function autoConnectClaude() {
  if (process.platform !== 'win32' || isDisabled()) return
  try {
    if (applyEntry(true)) console.log('[MCP] Registered ZeusPack in Claude Desktop config')
  } catch (err) {
    console.warn('[MCP] Claude Desktop auto-connect skipped:', err.message)
  }
}

export function registerClaudeIpc() {
  ipcMain.handle('mcp-claude-status', () => ({ success: true, ...claudeStatus() }))

  ipcMain.handle('mcp-claude-set', (_e, { enabled } = {}) => {
    try {
      setDisabled(!enabled)
      const changed = applyEntry(!!enabled)
      return { success: true, changed, ...claudeStatus() }
    } catch (err) {
      return { success: false, error: err.message, ...claudeStatus() }
    }
  })
}
