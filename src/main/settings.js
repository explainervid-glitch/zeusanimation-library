import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { ASSET_PACKS, pathAt } from '../shared/PathConfig.js'

const DEFAULT_TEMPLATES = [
  { id: 'anim_2d', label: '2D Animation',  filename: 'tmp_2d_animation.fla',    path: '' },
  { id: 'bg_2d',   label: '2D Background', filename: 'tmp_2d_background.fla',   path: '' },
  { id: 'anim_3d', label: '3D Animation',  filename: 'tmp_3d_animation.blend',  path: '' },
  { id: 'bg_3d',   label: '3D Background', filename: 'tmp_3d_background.blend', path: '' },
]

// NOTE: asset paths are NOT settings. They live in shared/PathConfig.js and are
// never written to settings.json — only which pack is selected is persisted.
const DEFAULT_SETTINGS = {
  activePathIndex: 0,
  templatePaths: DEFAULT_TEMPLATES.map(t => ({ id: t.id, path: t.path })),
  taggerUrl:      'http://192.168.1.27:8000',
  ragUrl:         'http://192.168.1.27:8001',
  llmUrl:         'http://192.168.1.27:8002',
  theme:          'light',
}

function getSettingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings() {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS, assetPaths: ASSET_PACKS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))

    // Legacy keys — paths now come from PathConfig, so discard any stored copy.
    delete parsed.assetPath
    delete parsed.assetPaths

    // Merge templatePaths
    const savedTemplates = parsed.templatePaths || []
    const mergedTemplates = DEFAULT_TEMPLATES.map(t => {
      const saved = savedTemplates.find(s => s.id === t.id)
      return { id: t.id, path: saved?.path || '' }
    })

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      templatePaths: mergedTemplates,
      // Read-only view for consumers that want labels; comes from PathConfig,
      // not from disk, so editing settings.json can't change it.
      assetPaths: ASSET_PACKS,
    }
  } catch {
    return { ...DEFAULT_SETTINGS, assetPaths: ASSET_PACKS }
  }
}

export function writeSettings(settings) {
  const current = readSettings()
  const merged  = { ...current, ...settings }
  // assetPaths is hardcoded config, never a stored preference. Drop it before
  // writing (and drop any copy an older build left in the file).
  delete merged.assetPaths
  writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return { ...merged, assetPaths: ASSET_PACKS }
}

export function getActiveAssetPath() {
  return pathAt(readSettings().activePathIndex ?? 0)
}

export function getTemplatePath(templateId) {
  const s        = readSettings()
  const template = s.templatePaths?.find(t => t.id === templateId)
  return template?.path ?? ''
}

export { DEFAULT_TEMPLATES }