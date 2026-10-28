// scripts/build-mcp.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Bundles mcp/zeuspack-mcp into one dependency-free file so it can ship inside
// the packaged app (electron-builder extraResources → resources/mcp/).
//
// Teammates run it with the app's own executable as the Node runtime
// (ELECTRON_RUN_AS_NODE=1, see mcp/zeuspack-mcp/zeuspack-mcp.cmd), so they need
// neither Node nor an npm install — only the deployed build.
// ─────────────────────────────────────────────────────────────────────────────

import { build } from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MCP_DIR = resolve(__dirname, '../mcp/zeuspack-mcp')

await build({
  entryPoints: [resolve(MCP_DIR, 'index.js')],
  outfile: resolve(MCP_DIR, 'dist/zeuspack-mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Electron 39 embeds Node 22.
  target: 'node22',
  // Some bundled deps are CommonJS and call require(); ESM output has none.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
