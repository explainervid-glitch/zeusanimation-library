import { useEffect, useState, useCallback, useRef } from 'react'
import { X, FolderOpen, Save, Check, RefreshCw, Plus, Trash2, File, Loader, Database, Sun, Moon, Link2, Sliders, Sparkles } from 'lucide-react'
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
    theme, setTheme,
    importCharactersEnabled, toggleImportCharactersEnabled,
    blenderImportEnabled, toggleBlenderImportEnabled,
    blenderImportMode, setBlenderImportMode,
  } = useSettingsStore()

  const { rescan, scanning, activePackIndex } = useAssetStore()

  const [activeTab, setActiveTab] = useState('general')

  const [pingStatus, setPingStatus] = useState('idle')
  const [ragPingStatus, setRagPingStatus] = useState('idle')
  const [embedStatus, setEmbedStatus] = useState('idle') // idle | running | done | error
  const [embedProgress, setEmbedProgress] = useState(null)  // { batch, totalBatches }
  const [embedCount, setEmbedCount] = useState(null)
  const unsubEmbed = useRef(null)

  // ── Per-style tagger hints (stored in each pack's stylenames.json) ──
  const [styleList, setStyleList]     = useState([])   // [{ suffix, name, description }]
  const [styleHints, setStyleHints]   = useState({})   // { [suffix]: "hint text" }
  const [hintPackIndex, setHintPackIndex] = useState(0)
  const [hintsLoading, setHintsLoading] = useState(false)
  const [hintsSaving, setHintsSaving]   = useState(false)
  const [hintsSaved, setHintsSaved]     = useState(false)
  const [draftingId, setDraftingId]     = useState(null)   // suffix being AI-drafted, or null

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

  const loadHints = useCallback(async (packIndex) => {
    setHintsLoading(true)
    try {
      const res  = await window.api.getStyleNames({ packIndex })
      const list = []
      const map  = {}
      if (res?.success && res.data) {
        for (const [suffix, entry] of Object.entries(res.data)) {
          if (!entry || typeof entry !== 'object') continue
          const description = (entry.description || '').trim()
          if (!description) continue   // hide styles with an empty description
          list.push({ suffix, name: entry.name || `Style ${suffix}`, description })
          map[suffix] = entry.tagger_hint || ''
        }
      }
      list.sort((a, b) => Number(a.suffix) - Number(b.suffix))
      setStyleList(list)
      setStyleHints(map)
    } catch {
      setStyleList([])
      setStyleHints({})
    }
    setHintsLoading(false)
  }, [])

  // Auto-check servers + reset the hint pack to the active one when modal opens
  useEffect(() => {
    if (isOpen) {
      checkTagger()
      checkRag()
      setHintPackIndex(activePackIndex ?? 0)
    }
  }, [isOpen, checkTagger, checkRag, activePackIndex])

  // (Re)load hints when the modal opens or the selected pack changes
  useEffect(() => {
    if (isOpen) loadHints(hintPackIndex)
  }, [isOpen, hintPackIndex, loadHints])

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

  const saveHints = () => window.api
    .saveStyleHints({ hints: styleHints, packIndex: hintPackIndex })
    .catch(() => ({ success: false }))

  const handleSaveHints = async () => {
    setHintsSaving(true)
    const res = await saveHints()
    setHintsSaving(false)
    if (res?.success) {
      setHintsSaved(true)
      setTimeout(() => setHintsSaved(false), 2500)
    }
  }

  // AI-draft a hint from a few sample images of the style, then drop it into
  // the textarea for the user to review + edit before saving.
  const handleDraft = async (suffix) => {
    if (draftingId != null) return
    setDraftingId(suffix)
    try {
      const res = await window.api.generateStyleGuide({ packIndex: hintPackIndex, suffix })
      if (res?.success && res.hint) {
        setStyleHints((h) => ({ ...h, [suffix]: res.hint }))
      }
    } finally {
      setDraftingId(null)
    }
  }

  const handleSaveAndRescan = async () => {
    await saveSettings()
    await saveHints()
    closeSettings()
    rescan()
  }

  const handleOk = async () => {
    await saveSettings()
    await saveHints()
    closeSettings()
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

  const TABS = [
    { id: 'general', label: 'General', icon: Sliders },
    { id: 'tagger',  label: 'Tagger',  icon: Sparkles },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={closeSettings}
    >
      {/* Modal Container */}
      <div
        className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed at top */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-c-border flex-shrink-0">
          <h2 className="text-sm font-bold text-c-text">Preferences</h2>
          <button
            onClick={closeSettings}
            className="text-c-text-3 hover:text-c-text transition-colors p-1 rounded-lg hover:bg-c-raised"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — left tab rail + right content */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Tab rail ── */}
          <nav className="w-40 flex-shrink-0 border-r border-c-border p-3 space-y-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all
                  ${activeTab === id
                    ? 'bg-c-accent text-c-on-accent shadow-sm'
                    : 'text-c-text-3 hover:bg-c-hover hover:text-c-text'
                  }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </nav>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin">

            {/* ══════════ GENERAL TAB ══════════ */}
            {activeTab === 'general' && (
              <>
                {/* ── Asset Paths ── */}
                <div className="space-y-4 pb-4 border-b border-c-border">
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

                  <div className="bg-c-raised border border-c-border rounded-lg px-3 py-3 space-y-3">
                    {assetPaths.map((item, index) => {
                      const isLast = index === assetPaths.length - 1
                      return (
                        <div
                          key={index}
                          className={`flex flex-col gap-1.5 ${!isLast ? 'pb-3 border-b border-c-border/50' : ''}`}
                        >
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

                {/* ── Appearance ── */}
                <div className="pb-4 border-b border-c-border">
                  <label className="text-xs font-semibold text-c-text uppercase tracking-wider block mb-2">
                    Appearance
                  </label>
                  <button
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className="flex items-center gap-2 text-[11px] text-c-text-3 hover:text-c-text transition-colors"
                    title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                  >
                    <span className="relative inline-block w-8 h-4 rounded-full bg-c-raised border border-c-border-2 transition-colors">
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-c-accent transition-all duration-200
                          ${theme === 'dark' ? 'left-0.5' : 'left-4'}`}
                      />
                    </span>
                    {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
                    <span className="capitalize">{theme}</span>
                  </button>
                </div>

                {/* ── Character Import ── */}
                <div className="pb-4 border-b border-c-border">
                  {/* Heading + master toggle on one row */}
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                      Character Import
                    </label>
                    <button
                      onClick={toggleImportCharactersEnabled}
                      title={importCharactersEnabled ? 'Disable Import Characters' : 'Enable Import Characters'}
                      className="flex-shrink-0"
                    >
                      <span className="relative inline-block w-8 h-4 rounded-full bg-c-raised border border-c-border-2 transition-colors">
                        <span
                          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-c-accent transition-all duration-200
                            ${importCharactersEnabled ? 'left-4' : 'left-0.5'}`}
                        />
                      </span>
                    </button>
                  </div>

                  {importCharactersEnabled && (
                    <div className="mt-2 pl-1 border-l border-c-border-2 space-y-2">
                      {/* Import to Blender on/off */}
                      <button
                        onClick={toggleBlenderImportEnabled}
                        className="flex items-center gap-2 text-[11px] text-c-text-3 hover:text-c-text transition-colors pl-1"
                        title={blenderImportEnabled ? 'Disable import to Blender' : 'Enable import to Blender'}
                      >
                        <span className="relative inline-block w-8 h-4 rounded-full bg-c-raised border border-c-border-2 transition-colors">
                          <span
                            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-c-accent transition-all duration-200
                              ${blenderImportEnabled ? 'left-4' : 'left-0.5'}`}
                          />
                        </span>
                        <Link2 size={12} />
                        <span>{blenderImportEnabled ? 'Import to Blender' : 'Send to Project only'}</span>
                      </button>

                      {/* Append vs link method */}
                      {blenderImportEnabled && (
                        <button
                          onClick={() => setBlenderImportMode(blenderImportMode === 'append' ? 'link' : 'append')}
                          className="flex items-center gap-2 text-[11px] text-c-text-3 hover:text-c-text transition-colors pl-1"
                          title="Switch import method"
                        >
                          <span className="relative inline-block w-8 h-4 rounded-full bg-c-raised border border-c-border-2 transition-colors">
                            <span
                              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-c-accent transition-all duration-200
                                ${blenderImportMode === 'link' ? 'left-4' : 'left-0.5'}`}
                            />
                          </span>
                          <span>Method: <span className="text-c-text font-medium capitalize">{blenderImportMode}</span></span>
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-c-text-4 mt-1.5 leading-relaxed">
                    {!importCharactersEnabled
                      ? 'Off: no Import button; clicking a character card opens the asset.'
                      : !blenderImportEnabled
                        ? 'Character cards show an Import button and open only via it — Import copies into the project.'
                        : blenderImportMode === 'append'
                          ? 'Import copies a character into the project, then appends its collection into Blender.'
                          : 'Import copies a character into the project, then links its collection into Blender.'}
                  </p>
                </div>

                {/* ── Template Files ── */}
                <div className="pb-4 border-b border-c-border">
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
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-c-text-2 flex-1">
                              {def.label}
                            </span>
                            <span className="text-[9px] font-mono text-c-text-4 bg-c-base px-1.5 py-0.5 rounded border border-c-border flex-shrink-0">
                              {def.filename}
                            </span>
                          </div>

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

                {/* ── RAG Server ── */}
                <div className="space-y-2">
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
              </>
            )}

            {/* ══════════ TAGGER TAB ══════════ */}
            {activeTab === 'tagger' && (
              <>
                {/* ── AI Tagger Server (endpoint) ── */}
                <div className="space-y-2 pb-4 border-b border-c-border">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                      Tagger Endpoint
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
                        <span className="text-[10px] text-c-text-4 ml-1">— Pastikan tagger_server.py jalan di </span>
                        <span className="text-[10px] text-c-text-4 font-mono">{taggerUrl}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Style Hints ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-c-text uppercase tracking-wider">
                      Style Hints
                    </label>
                    <button
                      onClick={handleSaveHints}
                      disabled={hintsSaving || hintsLoading}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-c-border-2 text-c-text-3 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
                    >
                      {hintsSaved
                        ? <><Check size={11} /> Saved</>
                        : hintsSaving
                          ? <><Loader size={11} className="animate-spin" /> Saving</>
                          : <><Save size={11} /> Save Hints</>}
                    </button>
                  </div>

                  <p className="text-[11px] text-c-text-3 leading-relaxed">
                    Tell the AI tagger how each style looks so it doesn&apos;t misread it
                    (e.g. &ldquo;monochrome ground is stylized terrain, not snow&rdquo;).
                    Saved into this pack&apos;s <span className="font-mono text-c-text-4">stylenames.json</span> and
                    applied to newly tagged assets.
                  </p>

                  {/* Pack selector — edit hints for either pack without switching */}
                  {assetPaths.length > 1 && (
                    <div className="flex items-center gap-1 bg-c-raised border border-c-border rounded-lg p-0.5 w-fit">
                      {assetPaths.map((p, i) => (
                        <button
                          key={i}
                          onClick={() => setHintPackIndex(i)}
                          className={`px-3 py-1 rounded-md text-[11px] font-medium transition-all
                            ${hintPackIndex === i
                              ? 'bg-c-accent text-c-on-accent'
                              : 'text-c-text-3 hover:text-c-text'
                            }`}
                        >
                          {p.label || `Pack ${i + 1}`}
                        </button>
                      ))}
                    </div>
                  )}

                  {hintsLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-c-text-4 py-4">
                      <Loader size={12} className="animate-spin" /> Loading styles…
                    </div>
                  ) : styleList.length === 0 ? (
                    <p className="text-[11px] text-c-text-4 py-4">
                      No named styles in this pack. Give a style a description in
                      its rename dialog to show it here.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {styleList.map((style) => (
                        <div
                          key={style.suffix}
                          className="bg-c-raised border border-c-border rounded-lg px-3 py-2.5 space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-c-text-2">
                              {style.name}
                            </span>
                            <span className="text-[9px] font-mono text-c-text-4 bg-c-base px-1.5 py-0.5 rounded border border-c-border">
                              #{style.suffix}
                            </span>
                            <span className="flex-1 text-[10px] text-c-text-4 truncate">
                              {style.description}
                            </span>
                            <button
                              onClick={() => handleDraft(style.suffix)}
                              disabled={draftingId != null}
                              title="Draft this hint with AI from a few sample images of this style"
                              className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-c-border-2 text-c-text-3 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
                            >
                              {draftingId === style.suffix
                                ? <><Loader size={10} className="animate-spin" /> Drafting…</>
                                : <><Sparkles size={10} className="text-c-accent" /> Draft with AI</>}
                            </button>
                          </div>
                          <textarea
                            value={styleHints[style.suffix] ?? ''}
                            onChange={(e) => setStyleHints((h) => ({ ...h, [style.suffix]: e.target.value }))}
                            placeholder="e.g. Monochrome isometric style — pale/grey ground is stylized terrain, NOT snow. Describe surfaces by shape, not colour."
                            rows={3}
                            className="w-full bg-c-base border border-c-border rounded px-2 py-1.5 text-[11px] text-c-text placeholder-c-text-4 outline-none focus:border-c-accent transition-colors resize-y leading-relaxed"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

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

          {/* Actions — right (OK is the primary/accent button) */}
          <div className="flex gap-2">
            <button
              onClick={handleSaveAndRescan}
              disabled={loading || scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-c-raised border border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text transition-all disabled:opacity-40"
            >
              <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
              Save & Rescan
            </button>
            <button
              onClick={handleOk}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
            >
              {saved
                ? <><Check size={12} /> Saved</>
                : <><Save size={12} /> OK</>
              }
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
