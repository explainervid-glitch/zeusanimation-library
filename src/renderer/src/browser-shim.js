/**
 * Browser Shim — Mock window.api for browser (non-Electron) mode.
 *
 * When the app runs in a regular browser (e.g. http://localhost:5173),
 * there's no preload script, so window.api is undefined. This shim
 * provides mock implementations so the UI doesn't crash and you can
 * develop/test the renderer in a browser.
 *
 * All IPC calls return safe empty/error responses. For real data,
 * run via `npm run dev` (Electron).
 */

const noop = () => {}
const noopAsync = async () => ({ success: false, error: 'Browser mode: IPC not available' })
const noopAsyncArray = async () => []
const noopAsyncObj = async () => ({})

const mockApi = {
  // Window controls (no-op in browser mode)
  windowMinimize:           ()   => {},
  windowToggleMaximize:     ()   => {},
  windowClose:              ()   => {},
  windowIsMaximized:        ()   => Promise.resolve(false),
  onWindowMaximizedChanged: (cb) => () => {},

  // Assets
  getAssetTree:        ()            => Promise.resolve([]),
  getAssetsByCategory: (id)          => Promise.resolve([]),
  rescanAssets:        ()            => Promise.resolve({ success: false, error: 'Browser mode' }),
  openAssetFile:       (path)        => Promise.resolve({ success: false, error: 'Browser mode' }),
  renameStyle:         (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  switchPack:          (index)       => Promise.resolve({ success: false, error: 'Browser mode', isEmpty: true }),

  // Asset JSON edit
  readAssetJson:       (jsonPath)    => Promise.resolve({ success: false, error: 'Browser mode' }),
  writeAssetJson:      (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  getTypeCategories:   (styleTypeId) => Promise.resolve([]),

  // Add
  getStyleNames:       ()            => Promise.resolve([]),
  addCategory:         (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  deleteCategory:      (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  createAsset:         (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  createProject:       (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  sendToProject:       (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  deleteProjectFile:   (filePath)    => Promise.resolve({ success: false, error: 'Browser mode' }),
  openPath:            (path)        => Promise.resolve({ success: false, error: 'Browser mode' }),

  // Blender Bridge
  blenderScanPorts:      ()                                  => Promise.resolve([]),
  blenderGetCollections: (filePath, port)                    => Promise.resolve([]),
  blenderAppend:         ({ filePath, collection, port })    => Promise.resolve({ success: false, error: 'Browser mode' }),
  blenderLink:           ({ filePath, collection, port })    => Promise.resolve({ success: false, error: 'Browser mode' }),

  // Settings
  getSettings:         ()            => Promise.resolve({
    assetPaths: [], activePathIndex: 0, templatePaths: [], taggerUrl: '', ragUrl: ''
  }),
  saveSettings:        (settings)    => Promise.resolve({ success: false, error: 'Browser mode' }),
  selectFolder:        ()            => Promise.resolve({ canceled: true }),
  selectFile:          (filters)     => Promise.resolve({ canceled: true }),

  // AI Chat
  aiChat:              (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  aiGenerate:          (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),

  // Search & Tagger
  searchAssets:        (params)      => Promise.resolve([]),
  taggerPing:          ()            => Promise.resolve({ success: false }),
  taggerPingVideo:     ()            => Promise.resolve({ success: false }),
  ragPing:             ()            => Promise.resolve({ success: false }),
  llmPing:             ()            => Promise.resolve({ success: false }),
  taggerGenerateVideo: (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),
  taggerGenerate:      (payload)     => Promise.resolve({ success: false, error: 'Browser mode' }),

  // Scan logs
  onScanLog:       (cb)      => noop,
  offScanLog:      ()        => noop,

  // DB
  checkDbUpdated:  (params)  => Promise.resolve({ updated: false }),
  deleteAsset:     (params)  => Promise.resolve({ success: false, error: 'Browser mode' }),
  setAssetPreview: (params)  => Promise.resolve({ success: false, error: 'Browser mode' }),
  scanPreviewFile: (params)  => Promise.resolve({ success: false, error: 'Browser mode' }),

  // RAG
  ragSearch:       (params)  => Promise.resolve([]),
  ragIndexUpsert:  (payload) => Promise.resolve({ success: false, error: 'Browser mode' }),
  ragIndexBulk:    ()        => Promise.resolve({ success: false, error: 'Browser mode' }),
  ragIndexDelete:  (params)  => Promise.resolve({ success: false, error: 'Browser mode' }),
  onRagEmbedProgress: (cb)   => noop,
}

// Install shim only if running outside Electron (no preload)
if (typeof window !== 'undefined' && !window.api) {
  window.api = mockApi
  console.warn(
    '%c[Browser Shim] Running in browser mode — IPC calls return mock data. ' +
    'Run "npm run dev" for full Electron functionality.',
    'color: #f59e0b; font-weight: 600'
  )
}
