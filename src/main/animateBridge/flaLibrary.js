// ─── READ A .fla's LIBRARY FROM DISK (no Adobe Animate needed) ───
// A modern .fla is a ZIP of XML. The library is the set of LIBRARY/*.xml
// entries (+ folder entries), so we can list it straight from the file —
// instantly, whether or not Animate is running.
//
// We ship a tiny dependency-free zip reader because Animate writes a slightly
// nonstandard end-of-central-directory offset that trips strict parsers
// (Python's zipfile choked on these very files). We locate the central
// directory by `eocd - cdSize` instead of trusting the stored offset, and read
// entries using the central directory's (reliable) compressed sizes.
import { readFileSync } from 'fs'
import { inflateRawSync } from 'zlib'
import { basename } from 'path'

const SIG_LOCAL = 0x04034b50  // PK\x03\x04
const SIG_CDIR  = 0x02014b50  // PK\x01\x02
const SIG_EOCD  = 0x06054b50  // PK\x05\x06

// Parse the central directory → [{ name, method, compSize, offset }]
function parseCentralDirectory(buf) {
  // Find EOCD by scanning back from the end (there's a variable-length comment).
  let e = buf.length - 22
  const min = Math.max(0, buf.length - 22 - 65535)
  for (; e >= min; e--) if (buf.readUInt32LE(e) === SIG_EOCD) break
  if (e < min) throw new Error('Not a zip (no EOCD found)')

  const cdSize = buf.readUInt32LE(e + 12)
  // Most reliable start: EOCD position minus the central-directory size.
  let cdStart = e - cdSize
  if (cdStart < 0 || buf.readUInt32LE(cdStart) !== SIG_CDIR) {
    // Fall back to the stored offset if the computed one doesn't land right.
    cdStart = buf.readUInt32LE(e + 16)
  }
  if (cdStart < 0 || cdStart > buf.length - 4 || buf.readUInt32LE(cdStart) !== SIG_CDIR) {
    throw new Error('Central directory not found')
  }

  const entries = []
  let i = cdStart
  while (i <= buf.length - 46 && buf.readUInt32LE(i) === SIG_CDIR) {
    const method   = buf.readUInt16LE(i + 10)
    const compSize = buf.readUInt32LE(i + 20)
    const nameLen  = buf.readUInt16LE(i + 28)
    const extraLen = buf.readUInt16LE(i + 30)
    const commLen  = buf.readUInt16LE(i + 32)
    const offset   = buf.readUInt32LE(i + 42)
    const name     = buf.toString('utf8', i + 46, i + 46 + nameLen)
    entries.push({ name, method, compSize, offset })
    i += 46 + nameLen + extraLen + commLen
  }
  return entries
}

// Decompress one entry using its local header + central-directory compSize.
function inflateEntry(buf, entry) {
  const o = entry.offset
  if (buf.readUInt32LE(o) !== SIG_LOCAL) return null
  const nameLen  = buf.readUInt16LE(o + 26)
  const extraLen = buf.readUInt16LE(o + 28)
  const start = o + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return raw               // stored
  if (entry.method === 8) return inflateRawSync(raw)  // deflate
  return null
}

// Read the leaf element type from a LIBRARY/*.xml (only needs the root tag).
function classifyXml(xmlHead) {
  if (/<DOMSymbolItem\b/.test(xmlHead)) {
    const m = xmlHead.match(/symbolType="([^"]+)"/)
    return m ? m[1] : 'movie clip'   // graphic | movie clip | button
  }
  if (/<DOMBitmapItem\b/.test(xmlHead)) return 'bitmap'
  if (/<DOMSoundItem\b/.test(xmlHead))  return 'sound'
  if (/<DOMVideoItem\b/.test(xmlHead))  return 'video'
  if (/<DOMFontItem\b/.test(xmlHead))   return 'font'
  return 'symbol'
}

// PUBLIC: read a .fla's library as the same shape the bridge/JSFL returns:
// { doc, count, items: [{ path, name, type, depth }] }
export function readFlaLibrary(filePath) {
  const buf = readFileSync(filePath)
  const entries = parseCentralDirectory(buf)
  const items = []

  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/')
    if (!/^LIBRARY\//i.test(n)) continue
    const rel = n.slice('LIBRARY/'.length)
    if (!rel) continue

    if (rel.endsWith('/')) {                 // explicit folder entry
      const p = rel.slice(0, -1)
      if (p) items.push({ path: p, type: 'folder' })
      continue
    }
    if (!/\.xml$/i.test(rel)) continue        // ignore non-xml (e.g. bin data)

    const path = rel.replace(/\.xml$/i, '')
    let type = 'symbol'
    try {
      const decoded = inflateEntry(buf, e)
      if (decoded) type = classifyXml(decoded.toString('utf8', 0, 600))
    } catch { /* keep generic 'symbol' */ }
    items.push({ path, type })
  }

  const out = items.map((it) => {
    const parts = it.path.split('/')
    return { path: it.path, name: parts[parts.length - 1], type: it.type, depth: parts.length - 1 }
  })
  return { doc: basename(filePath), count: out.length, items: out }
}
