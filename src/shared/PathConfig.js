// ─── PATH CONFIG ──────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the asset packs.
//
// Edit this file to add / rename / repoint a pack. Both the Electron main
// process (which resolves the folder on disk) and the renderer (which renders
// the toolbar's pack dropdown) import from here, so the label and the path can
// never drift apart.
//
// These are intentionally NOT user preferences: they are never written to
// settings.json and cannot be changed from the Settings modal. Only which pack
// is currently selected (`activePathIndex`) is persisted.
//
// `index` is positional and MUST stay stable — it is what the app stores as the
// active pack and what switch-pack looks up. To retire a pack, blank its `path`
// (it will be hidden) rather than deleting the entry, or every pack after it
// shifts and users reopen the wrong library.

export const ASSET_PACKS = [
  { index: 0, label: '2D',            path: 'W:\\2D PACK ZEUSANIMATION\\FULLPACK_Data\\StreamingAssets' },
  { index: 1, label: '3D',            path: 'W:\\3D PACK ZEUSANIMATION\\FULLPACK_Data\\StreamingAssets' },
  { index: 2, label: '2D Lagu Anak',  path: 'W:\\YOUTUBE ANAK\\Packs' },
  { index: 3, label: '-',             path: '' },
]

// Packs that actually have a path — what the dropdown should offer.
export function usablePacks() {
  return ASSET_PACKS.filter((p) => p.path && p.path.trim())
}

// Resolve a pack by its stored index. Falls back to the first usable pack so a
// stale index (e.g. a pack whose path was blanked) can't strand the app.
export function packAt(index) {
  const exact = ASSET_PACKS.find((p) => p.index === index)
  if (exact?.path) return exact
  return usablePacks()[0] ?? null
}

export function pathAt(index) {
  return packAt(index)?.path ?? ''
}
