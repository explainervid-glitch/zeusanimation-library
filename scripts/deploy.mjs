// scripts/deploy.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Deploys the built app to the team shared drive after electron-builder runs.
//
// Run manually:
//   node scripts/deploy.mjs
//
// Or add to package.json scripts (see bottom of this file for suggestions).
// ─────────────────────────────────────────────────────────────────────────────

import { execSync }                                    from 'child_process'
import { existsSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'fs'
import { join, resolve, dirname }                      from 'path'
import { fileURLToPath }                               from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Read version from package.json ──────────────────────────────────────────
const pkg     = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))
const VERSION = pkg.version   // e.g. "0.6.0"

// ── CONFIG ──────────────────────────────────────────────────────────────────
const SOURCE_DIR  = resolve(__dirname, '../dist/win-unpacked')
const DEPLOY_ROOT = 'W:\\00 - ZEUSPACK'
const BUILDS_DIR  = join(DEPLOY_ROOT, 'builds')
const TARGET_DIR  = join(BUILDS_DIR, VERSION)
const LATEST_FILE = join(DEPLOY_ROOT, 'latest.txt')
const KEEP_BUILDS = 3   // number of old builds to keep — set 0 to keep all

// ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
console.log('\n[Deploy] ═══════════════════════════════════════')
console.log(`[Deploy]  ZeusPack v${VERSION}`)
console.log('[Deploy] ═══════════════════════════════════════')
console.log(`  Source : ${SOURCE_DIR}`)
console.log(`  Target : ${TARGET_DIR}\n`)

if (!existsSync(SOURCE_DIR)) {
  console.error('[Deploy] ✗ Source not found:', SOURCE_DIR)
  console.error('  Run "npm run build:unpack" first.')
  process.exit(1)
}

if (!existsSync(DEPLOY_ROOT)) {
  console.error('[Deploy] ✗ Deploy root not found:', DEPLOY_ROOT)
  console.error('  Is the W: drive mapped and accessible?')
  process.exit(1)
}

if (existsSync(TARGET_DIR)) {
  console.warn(`[Deploy] ⚠ v${VERSION} already exists — overwriting.`)
}

// ── COPY via robocopy ───────────────────────────────────────────────────────
// robocopy exit codes 0-7 are all success variants (bitmask).
// Only 8+ are actual errors.
console.log('[Deploy] Copying files via robocopy...')
try {
  execSync(
    `robocopy "${SOURCE_DIR}" "${TARGET_DIR}" /E /IS /IT /NFL /NJH /NJS /NC /NS /NDL`,
    { stdio: 'inherit' }
  )
} catch (err) {
  const code = err.status ?? 0
  if (code >= 8) {
    console.error(`[Deploy] ✗ robocopy failed (exit code ${code})`)
    console.error('  Check network access and W: drive permissions.')
    process.exit(1)
  }
}
console.log('[Deploy] ✓ Files copied.')

// ── UPDATE latest.txt ───────────────────────────────────────────────────────
writeFileSync(LATEST_FILE, VERSION, 'utf-8')
console.log(`[Deploy] ✓ latest.txt → ${VERSION}`)

// ── PRUNE OLD BUILDS ────────────────────────────────────────────────────────
if (KEEP_BUILDS > 0) {
  try {
    const all = readdirSync(BUILDS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(n => /^\d+\.\d+\.\d+$/.test(n))    // only semver-shaped folders
      .sort((a, b) => {
        const [aMaj, aMin, aPat] = a.split('.').map(Number)
        const [bMaj, bMin, bPat] = b.split('.').map(Number)
        return (bMaj - aMaj) || (bMin - aMin) || (bPat - aPat)   // newest first
      })

    const toDelete = all.slice(KEEP_BUILDS)

    if (toDelete.length === 0) {
      console.log('[Deploy] ✓ No old builds to prune.')
    } else {
      console.log(`[Deploy] Pruning ${toDelete.length} old build(s): ${toDelete.join(', ')}`)
      for (const old of toDelete) {
        rmSync(join(BUILDS_DIR, old), { recursive: true, force: true })
        console.log(`  Deleted: ${old}`)
      }
    }
  } catch (err) {
    console.warn('[Deploy] ⚠ Prune failed (non-fatal):', err.message)
  }
}

console.log(`\n[Deploy] ✓ v${VERSION} live. Team picks it up on next launcher.bat launch.\n`)


// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTED package.json ADDITIONS:
//
// "deploy":        "node scripts/deploy.mjs",
// "build:deploy":  "npm run build:unpack && node scripts/deploy.mjs",
// "release":       "npm run build:deploy"
//
// Workflow:
//   1. Bump version in package.json (e.g. 0.6.0 → 0.7.0)
//   2. npm run build:deploy
//   3. Team members running launcher.bat get v0.7.0 on next launch
// ─────────────────────────────────────────────────────────────────────────────
