import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Assets
  getAssetTree:        ()            => ipcRenderer.invoke('get-asset-tree'),
  getAssetsByCategory: (id)          => ipcRenderer.invoke('get-assets-by-category', id),
  getAssetsByStyleType: (styleTypeId) => ipcRenderer.invoke('get-assets-by-style-type', styleTypeId),
  rescanAssets:        ()            => ipcRenderer.invoke('rescan-assets'),
  openAssetFile:       (path)        => ipcRenderer.invoke('open-asset-file', path),
  renameStyle:         (payload)     => ipcRenderer.invoke('rename-style', payload),
  switchPack:          (index)       => ipcRenderer.invoke('switch-pack', index),

  // Asset JSON edit
  readAssetJson:       (jsonPath)    => ipcRenderer.invoke('read-asset-json', jsonPath),
  writeAssetJson:      (payload)     => ipcRenderer.invoke('write-asset-json', payload),
  getTypeCategories:   (styleTypeId) => ipcRenderer.invoke('get-type-categories', styleTypeId),

  // Add
  getStyleNames:       (params)      => ipcRenderer.invoke('get-style-names', params),
  saveStyleHints:      (payload)     => ipcRenderer.invoke('set-style-hints', payload),
  generateStyleGuide:  (payload)     => ipcRenderer.invoke('generate-style-guide', payload),
  addCategory:         (payload)     => ipcRenderer.invoke('add-category', payload),
  deleteCategory:      (payload)     => ipcRenderer.invoke('delete-category', payload),
  createAsset:         (payload)     => ipcRenderer.invoke('create-asset', payload),
  createProject:       (payload)     => ipcRenderer.invoke('create-project', payload),
  sendToProject:       (payload)     => ipcRenderer.invoke('send-to-project', payload),
  deleteProjectFile:   (filePath)    => ipcRenderer.invoke('delete-project-file', filePath),
  openPath:            (path)        => ipcRenderer.invoke('open-path', path),

  // Blender Bridge — ganti 3 baris lama dengan ini
  blenderScanPorts:      ()                                  => ipcRenderer.invoke('blender-scan-ports'),
  blenderGetCollections: (filePath, port)                    => ipcRenderer.invoke('blender-get-collections', filePath, port),
  blenderAppend:         ({ filePath, collection, port, tempScene }) => ipcRenderer.invoke('blender-append', { filePath, collection, port, tempScene }),
  blenderLink:           ({ filePath, collection, port })    => ipcRenderer.invoke('blender-link', { filePath, collection, port }),

  // Settings
  getSettings:         ()            => ipcRenderer.invoke('get-settings'),
  saveSettings:        (settings)    => ipcRenderer.invoke('save-settings', settings),
  selectFolder:        ()            => ipcRenderer.invoke('select-folder'),
  selectFile:          (filters)     => ipcRenderer.invoke('select-file', filters),

  // AI Chat
  aiChat:              (payload)     => ipcRenderer.invoke('ai-chat', payload),
  aiGenerate:          (payload)     => ipcRenderer.invoke('ai-generate', payload),
  aiScenes:            (payload)     => ipcRenderer.invoke('ai-scenes', payload),

  // Window controls (frameless title bar)
  windowMinimize:       ()  => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: ()  => ipcRenderer.send('window:toggle-maximize'),
  windowClose:          ()  => ipcRenderer.send('window:close'),
  windowIsMaximized:    ()  => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizedChanged: (cb) => {
    const handler = (_e, v) => cb(v)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', {
      ...api,
      searchAssets: (params) => ipcRenderer.invoke('search-assets', params),
      taggerPing:          ()        => ipcRenderer.invoke('tagger-ping'),
      taggerPingVideo:     ()        => ipcRenderer.invoke('tagger-ping-video'),
      ragPing:             ()        => ipcRenderer.invoke('rag-ping'),
      llmPing:             ()        => ipcRenderer.invoke('llm-ping'),
      queueStatus:         ()        => ipcRenderer.invoke('queue-status'),
      taggerGenerateVideo: (payload) => ipcRenderer.invoke('tagger-generate-video', payload),
      taggerGenerate:  (payload) => ipcRenderer.invoke('tagger-generate', payload),
      onScanLog:       (cb)      => ipcRenderer.on('scan-log', (_e, msg) => cb(msg)),
      offScanLog:      ()        => ipcRenderer.removeAllListeners('scan-log'),
      checkDbUpdated:  (params)  => ipcRenderer.invoke('check-db-updated', params),
      deleteAsset:     (params)  => ipcRenderer.invoke('delete-asset', params),
      setAssetPreview: (params)  => ipcRenderer.invoke('set-asset-preview', params),
      scanPreviewFile: (params)  => ipcRenderer.invoke('scan-preview-file', params),

      // RAG
      ragSearch:       (params)  => ipcRenderer.invoke('rag-search', params),
      ragIndexUpsert:  (payload) => ipcRenderer.invoke('rag-index-upsert', payload),
      ragIndexBulk:    ()        => ipcRenderer.invoke('rag-index-bulk'),
      ragIndexDelete:  (params)  => ipcRenderer.invoke('rag-index-delete', params),
      onRagEmbedProgress: (cb)   => {
        ipcRenderer.on('rag-embed-progress', (_e, data) => cb(data))
        return () => ipcRenderer.removeAllListeners('rag-embed-progress')
      },
    })
    
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}