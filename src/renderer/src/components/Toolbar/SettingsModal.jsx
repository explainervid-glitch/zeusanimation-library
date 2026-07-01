import { useEffect, useState, useCallback, useRef } from 'react'
import { X, FolderOpen, Save, Check, RefreshCw, Plus, Trash2, File, Loader, Database } from 'lucide-react'
import useSettingsStore, { TEMPLATE_DEFS } from '../../store/useSettingsStore'
import useAssetStore from '../../store/useAssetStore'

const MAX_PATHS = 5

export default function SettingsModal() {
  const {
    isOpen, closeSettings,
    assetPaths, addPath, removePath, updatePathValue, browsePath,
    templatePaths, updateTemplatePath, browseTemplatePath,
    taggerUrl, updateTaggerUrl,
    ragUrl, updateRagUrl,
    loading, saved, saveSettings,
  } = useSettingsStore()
  
  const { rescan, scanning } = useAssetStore()
  
  const [pingStatus, setPingStatus] = useState('idle')
  const [ragPingStatus, setRagPingStatus] = useState('idle')
  const [embedStatus, setEmbedStatus] = useState('idle') // idle | running | done | error
  const [embedProgress, setEmbedProgress] = useState(null)  // { batch, totalBatches }
  const [embedCount, setEmbedCount] = useState(null)
  const unsubEmbed = useRef(null)

  const checkTagger = useCallback(async () => {
    setPingStatus('checking')
    const result = await window.api.taggerPing().catch(() => ({ success: false }))
    setPingStatus(result.success ? 'online' : 'offline')
  }, [])

  const checkRag = useCallback(async () => {
    setRagPingStatus('checking')
    const result = await window.api.ragPing().catch(() => ({ success: false }))
    setRagPingStatus(result.success ? 'online' : 'offline')
  }, [])

  // Auto-check when modal opens
  useEffect(() => {
    if (isOpen) {
      checkTagger()
      checkRag()
    }
  }, [isOpen, checkTagger, checkRag])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') closeSettings() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeSettings])

  // Cleanup listener on unmount
  useEffect(() => () => { 
    if (unsubEmbed.current) unsubEmbed.current() 
  }, [])

  if (!isOpen) return null

  const handleSaveAndRescan = async () => {
    await saveSettings()
    closeSettings()
    rescan()
  }

  const handleReEmbed = () => {
    setEmbedStatus('running')
    setEmbedCount(null)
    setEmbedProgress(null)
    
    // Subscribe to progress events
    if (unsubEmbed.current) unsubEmbed.current()
    unsubEmbed.current = window.api.onRagEmbedProgress((data) => {
      if (data.status === 'progress') {
        setEmbedProgress({ batch: data.batch, totalBatches: data.totalBatches })
      } else if (data.status === 'done') {
        setEmbedStatus('done')
        setEmbedCount(data.indexed ?? null)
        setEmbedProgress(null)
        if (unsubEmbed.current) { unsubEmbed.current(); unsubEmbed.current = null }
        setTimeout(() => { setEmbedStatus('idle'); setEmbedCount(null) }, 5000)
      } else if (data.status === 'error') {
        setEmbedStatus('error')
        setEmbedProgress(null)
        if (unsubEmbed.current) { unsubEmbed.current(); unsubEmbed.current = null }
        setTimeout(() => setEmbedStatus('idle'), 4000)
      }
    })

    // Fire and forget — IPC returns immediately, embedding runs in background
    window.api.ragIndexBulk().catch(() => {
      setEmbedStatus('error')
      setTimeout(() => setEmbedStatus('idle'), 4000)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={closeSettings}
    >
      {/* Modal Container: Flex column with max-height for responsive scrolling */}
      <div
        className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed at top */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-c-border flex-shrink-0">
          <h2 className="text-sm font-bold text-c-text">Settings</h2>
          <button
            onClick={closeSettings}
            className="text-c-text-3 hover:text-c-text transition-colors p-1 rounded-lg hover:bg-c-raised"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — 2 columns with independent scrolling */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-c-border flex-1 overflow-hidden">
          
          {/* ── Left column: Asset Paths ── */}
          <div className="px-6 py-5 overflow-y-auto space-y-4 scrollbar-thin">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                Asset Paths
              </label>
              <button
                onClick={addPath}
                disabled={assetPaths.length >= MAX_PATHS}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all
                  ${assetPaths.length >= MAX_PATHS
                    ? 'opacity-30 cursor-not-allowed border-c-border text-c-text-4'
                    : 'border-c-border-2 text-c-text-3 hover:bg-c-hover hover:text-c-text'
                  }`}
              >
                <Plus size={11} />
                Add
                <span className="text-c-text-4 ml-0.5">({assetPaths.length}/{MAX_PATHS})</span>
              </button>
            </div>

            <p className="text-[11px] text-c-text-3">
              Main folder. Use the toolbar dropdown to switch packs.
            </p>

            {/* Unified Asset Paths Box */}
            <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3 space-y-3">
              {assetPaths.map((item, index) => {
                const isLast = index === assetPaths.length - 1
                
                return (
                  <div 
                    key={index} 
                    className={`flex flex-col gap-1.5 ${!isLast ? 'pb-3 border-b border-c-border/50' : ''}`}
                  >
                    {/* Row 1: Label + Delete */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-c-text-2 w-14 flex-shrink-0">
                        {item.label || `Pack ${index + 1}`}
                      </span>
                      <span className="text-c-text-4 text-[10px] flex-1 truncate font-mono">
                        {item.path || <span className="text-c-text-4">Not set</span>}
                      </span>
                      <button
                        onClick={() => removePath(index)}
                        disabled={assetPaths.length <= 1}
                        className={`flex-shrink-0 p-1 rounded transition-all
                          ${assetPaths.length <= 1
                            ? 'opacity-20 cursor-not-allowed text-c-text-4'
                            : 'text-c-text-2 hover:text-c-error hover:bg-c-error-bg/20'
                          }`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {/* Row 2: Path input + Browse */}
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={item.path}
                        onChange={(e) => updatePathValue(index, e.target.value)}
                        placeholder="W:\path\to\StreamingAssets"
                        className="flex-1 bg-c-base border border-c-border rounded px-2 py-1.5 text-[11px] text-c-text placeholder-c-text-4 outline-none focus:border-c-accent transition-colors font-mono"
                      />
                      <button
                        onClick={() => browsePath(index)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-c-hover border border-c-border-2 text-c-text-2 hover:bg-c-border hover:text-c-text transition-all flex-shrink-0"
                      >
                        <FolderOpen size={11} />
                        Browse
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right column: Templates + Tagger ── */}
          <div className="px-6 py-5 overflow-y-auto space-y-3 scrollbar-thin">
            
            {/* Unified Template Files Box */}
            <div>
              <label className="text-xs font-semibold text-c-text uppercase tracking-wider block mb-1">
                Template Files
              </label>
              <p className="text-[11px] text-c-text-3 mb-2">
                Template files for asset creation.
              </p>

              <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3 space-y-3">
                {TEMPLATE_DEFS.map((def, index) => {
                  const tPath = templatePaths.find(t => t.id === def.id)?.path || ''
                  const isLast = index === TEMPLATE_DEFS.length - 1
                  
                  return (
                    <div 
                      key={def.id} 
                      className={`flex flex-col gap-1.5 ${!isLast ? 'pb-3 border-b border-c-border/50' : ''}`}
                    >
                      {/* Row 1: Label + filename badge */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-c-text-2 flex-1">
                          {def.label}
                        </span>
                        <span className="text-[9px] font-mono text-c-text-4 bg-c-base px-1.5 py-0.5 rounded border border-c-border flex-shrink-0">
                          {def.filename}
                        </span>
                      </div>

                      {/* Row 2: Path input + Browse */}
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={tPath}
                          onChange={(e) => updateTemplatePath(def.id, e.target.value)}
                          placeholder={`W:\\templates\\${def.filename}`}
                          className="flex-1 bg-c-base border border-c-border rounded px-2 py-1.5 text-[11px] text-c-text placeholder-c-text-4 outline-none focus:border-c-accent transition-colors font-mono"
                        />
                        <button
                          onClick={() => browseTemplatePath(def.id)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-medium bg-c-hover border border-c-border-2 text-c-text-3 hover:bg-c-border hover:text-c-text transition-all flex-shrink-0"
                        >
                          <File size={11} />
                          Browse
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── AI Tagger Server ── */}
            <div className="pt-2 border-t border-c-border space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                  AI Tagger Server
                </label>
                <span className="text-[10px] text-c-text-4 bg-c-raised px-1.5 py-0.5 rounded border border-c-border font-mono">
                  Qwen2-VL:8000
                </span>
              </div>

              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={taggerUrl}
                  onChange={(e) => updateTaggerUrl(e.target.value)}
                  placeholder="http://192.168.1.27:8000"
                  className="flex-1 bg-c-base border border-c-border rounded px-2 py-1.5 text-[11px] text-c-text placeholder-c-text-4 outline-none focus:border-c-accent transition-colors font-mono"
                />
                <button
                  onClick={checkTagger}
                  disabled={pingStatus === 'checking'}
                  className="flex-shrink-0 p-1.5 rounded-lg border border-c-border-2 bg-c-raised text-c-text-3 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
                  title="Check connection"
                >
                  <RefreshCw size={11} className={pingStatus === 'checking' ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {pingStatus === 'idle' && (
                  <span className="text-[10px] text-c-text-4">— Not checked yet</span>
                )}
                {pingStatus === 'checking' && (
                  <> 
                    <Loader size={10} className="text-yellow-400 animate-spin" />
                    <span className="text-[10px] text-yellow-400">Checking...</span> 
                  </>
                )}
                {pingStatus === 'online' && (
                  <> 
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="text-[10px] text-green-400 font-medium">Server Online</span>
                    <span className="text-[10px] text-c-text-4 font-mono ml-1">{taggerUrl}</span> 
                  </>
                )}
                {pingStatus === 'offline' && (
                  <> 
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-[10px] text-red-400 font-medium">Server Offline</span>
                    <span className="text-[10px] text-c-text-4 ml-1">— Pastikan new_main.py jalan di </span>
                    <span className="text-[10px] text-c-text-4 font-mono">{taggerUrl}</span> 
                  </>
                )}
              </div>
            </div>

            {/* ── RAG Server ── */}
            <div className="pt-2 border-t border-c-border space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                  RAG Search Server
                </label>
                <span className="text-[10px] text-c-text-4 bg-c-raised px-1.5 py-0.5 rounded border border-c-border font-mono">
                  BGE-M3:8001
                </span>
              </div>

              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={ragUrl}
                  onChange={(e) => updateRagUrl(e.target.value)}
                  placeholder="http://192.168.1.27:8001"
                  className="flex-1 bg-c-base border border-c-border rounded px-2 py-1.5 text-[11px] text-c-text placeholder-c-text-4 outline-none focus:border-c-accent transition-colors font-mono"
                />
                <button
                  onClick={checkRag}
                  disabled={ragPingStatus === 'checking'}
                  className="flex-shrink-0 p-1.5 rounded-lg border border-c-border-2 bg-c-raised text-c-text-3 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
                  title="Check connection"
                >
                  <RefreshCw size={11} className={ragPingStatus === 'checking' ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {ragPingStatus === 'idle' && (
                  <span className="text-[10px] text-c-text-4">— Not checked yet</span>
                )}
                {ragPingStatus === 'checking' && (
                  <> 
                    <Loader size={10} className="text-yellow-400 animate-spin" />
                    <span className="text-[10px] text-yellow-400">Checking...</span> 
                  </>
                )}
                {ragPingStatus === 'online' && (
                  <> 
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="text-[10px] text-green-400 font-medium">Server Online</span>
                    <span className="text-[10px] text-c-text-4 font-mono ml-1">{ragUrl}</span> 
                  </>
                )}
                {ragPingStatus === 'offline' && (
                  <> 
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-[10px] text-red-400 font-medium">Server Offline</span>
                    <span className="text-[10px] text-c-text-4 ml-1">— Pastikan rag_server.py jalan di </span>
                    <span className="text-[10px] text-c-text-4 font-mono">{ragUrl}</span> 
                  </>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer - Fixed at bottom */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-c-border bg-c-base/40 flex-shrink-0">
          {/* Rescan This Pack — left */}
          <button
            onClick={() => { closeSettings(); rescan() }}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-c-raised border border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Rescan This Pack'}
          </button>

          {/* Re-embed Assets — center */}
          <button
            onClick={handleReEmbed}
            disabled={embedStatus === 'running' || ragPingStatus !== 'online'}
            title={ragPingStatus !== 'online' ? 'RAG server must be online first' : 'Re-index all assets into vector DB (runs in background)'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-c-raised border border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Database size={12} className={embedStatus === 'running' ? 'animate-pulse text-c-accent' : ''} />
            {embedStatus === 'idle' && 'Re-embed Assets'}
            {embedStatus === 'running' && !embedProgress && 'Starting...'}
            {embedStatus === 'running' && embedProgress && `Batch ${embedProgress.batch}/${embedProgress.totalBatches}`}
            {embedStatus === 'done' && `Done${embedCount != null ? ` (${embedCount})` : ''} ✓`}
            {embedStatus === 'error' && 'Embed Failed'}
          </button>

          {/* Save — right */}
          <div className="flex gap-2">
            <button
              onClick={saveSettings}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-c-raised border border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
            >
              {saved
                ? <><Check size={12} className="text-green-400" /> Saved</>
                : <><Save size={12} /> Save</>
              }
            </button>
            <button
              onClick={handleSaveAndRescan}
              disabled={loading || scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
              Save & Rescan
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}