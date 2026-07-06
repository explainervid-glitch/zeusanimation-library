import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

const DEFAULT_TEMPLATES = [
  { id: 'anim_2d', label: '2D Animation',  filename: 'tmp_2d_animation.fla',    path: '' },
  { id: 'bg_2d',   label: '2D Background', filename: 'tmp_2d_background.fla',   path: '' },
  { id: 'anim_3d', label: '3D Animation',  filename: 'tmp_3d_animation.blend',  path: '' },
  { id: 'bg_3d',   label: '3D Background', filename: 'tmp_3d_background.blend', path: '' },
]

const DEFAULT_SETTINGS = {
  assetPaths: [
    { label: '2D', path: 'W:\\2D PACK ZEUSANIMATION\\FULLPACK_Data\\StreamingAssets' },
    { label: '3D', path: 'W:\\3D PACK ZEUSANIMATION\\FULLPACK_Data\\StreamingAssets' },
  ],
  activePathIndex: 0,
  templatePaths: DEFAULT_TEMPLATES.map(t => ({ id: t.id, path: t.path })),
  taggerUrl:      'http://192.168.1.27:8000',
  taggerVideoUrl: 'http://192.168.1.27:8001',
  ragUrl:         'http://192.168.1.27:8001',
  theme:          'dark',
}

function getSettingsPath() {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings() {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))

    // Migrasi format lama (single assetPath string)
    if (parsed.assetPath && !parsed.assetPaths) {
      parsed.assetPaths = [{ label: '2D', path: parsed.assetPath }]
      delete parsed.assetPath
    }

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
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(settings) {
  const current = readSettings()
  const merged  = { ...current, ...settings }
  if (merged.assetPaths) merged.assetPaths = merged.assetPaths.slice(0, 5)
  writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function getActiveAssetPath() {
  const s   = readSettings()
  const idx = s.activePathIndex ?? 0
  return s.assetPaths?.[idx]?.path ?? ''
}

export function getTemplatePath(templateId) {
  const s        = readSettings()
  const template = s.templatePaths?.find(t => t.id === templateId)
  return template?.path ?? ''
}

export { DEFAULT_TEMPLATES }