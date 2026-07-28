import { useState, useEffect, useRef } from 'react'
import { X, Layers, Loader, Check, AlertCircle, Image, Users, PersonStanding, Lightbulb } from 'lucide-react'
import useAssetStore from '../../store/useAssetStore'

// The four folder prefixes the scanner recognises. `image` maps to "Character"
// — the folder name and the app's label differ, so both are shown.
const TYPES = [
  { prefix: 'background',  label: 'Background',  Icon: Image },
  { prefix: 'image',       label: 'Character',   Icon: Users },
  { prefix: 'movement',    label: 'Movement',    Icon: PersonStanding },
  { prefix: 'inspiration', label: 'Inspiration', Icon: Lightbulb },
]

export default function AddStyleModal({ isOpen, onClose }) {
  const tree = useAssetStore((s) => s.tree)

  const [name, setName]         = useState('')
  const [desc, setDesc]         = useState('')
  const [picked, setPicked]     = useState(() => new Set(TYPES.map(t => t.prefix)))
  const [copyFrom, setCopyFrom] = useState('')      // '' = start empty
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [done, setDone]         = useState(null)    // { styleId, suffix }
  const nameRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setName(''); setDesc(''); setPicked(new Set(TYPES.map(t => t.prefix)))
    setCopyFrom(''); setError(null); setDone(null); setSaving(false)
    const t = setTimeout(() => nameRef.current?.focus(), 60)
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const toggle = (prefix) => {
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(prefix) ? next.delete(prefix) : next.add(prefix)
      return next
    })
  }

  const handleCreate = async () => {
    if (!picked.size || saving) return
    setSaving(true); setError(null)
    const res = await window.api.addStyle({
      name, description: desc,
      types: [...picked],
      copyFromSuffix: copyFrom === '' ? null : copyFrom,
    }).catch((e) => ({ success: false, error: e.message }))
    setSaving(false)

    if (!res.success) { setError(res.error || 'Could not create style.'); return }
    // The handler returns the rebuilt tree — no rescan needed.
    if (res.tree) useAssetStore.setState({ tree: res.tree })
    setDone(res.data)
    setTimeout(onClose, 1400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-c-surface border border-c-border rounded-2xl shadow-2xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border">
          <div className="flex items-center gap-2.5">
            <Layers size={15} className="text-c-accent" />
            <h2 className="text-sm font-bold text-c-text">Add Style</h2>
          </div>
          <button onClick={onClose} className="text-c-text-3 hover:text-c-text p-1 rounded-lg hover:bg-c-raised transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-c-text-2 block mb-1.5">Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2D Flat Vector"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-c-raised text-c-text
                placeholder-c-text-4 border border-c-border-2 focus:border-c-accent outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-c-text-2 block mb-1.5">Description</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Shown under the style name"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-c-raised text-c-text
                placeholder-c-text-4 border border-c-border-2 focus:border-c-accent outline-none transition-colors"
            />
          </div>

          {/* Which folders to create */}
          <div>
            <label className="text-[11px] font-medium text-c-text-2 block mb-1.5">
              Asset types <span className="text-c-text-4 font-normal">— one folder each</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {TYPES.map(({ prefix, label, Icon }) => {
                const on = picked.has(prefix)
                return (
                  <button
                    key={prefix}
                    onClick={() => toggle(prefix)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all
                      ${on ? 'bg-c-accent/10 border-c-accent text-c-accent'
                           : 'bg-c-raised border-c-border text-c-text-3 hover:text-c-text'}`}
                  >
                    <Icon size={12} className="flex-shrink-0" />
                    <span className="text-[11px] font-medium flex-1 truncate">{label}</span>
                    {on && <Check size={11} className="flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Category source */}
          <div>
            <label className="text-[11px] font-medium text-c-text-2 block mb-1.5">Categories</label>
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-c-raised text-c-text
                border border-c-border-2 focus:border-c-accent outline-none transition-colors"
            >
              <option value="">Start empty</option>
              {(tree || []).map((s) => (
                <option key={s.id} value={String(s.id)}>Copy from {s.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-c-text-4 mt-1 leading-relaxed">
              Copying is recommended — with no categories, every asset you add lands in ⚠ Uncategorized.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
              <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-c-error">{error}</p>
            </div>
          )}

          {done && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/30">
              <Check size={13} className="text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-green-400">
                Created <span className="font-semibold">Style {done.styleId}</span> — folders use suffix
                <span className="font-mono"> {done.suffix}</span>.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-c-border bg-c-base/40">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !picked.size || !!done}
            title={!picked.size ? 'Pick at least one asset type' : 'Create the style folders and categories'}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
              bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-40"
          >
            {done ? <><Check size={12} /> Created</>
              : saving ? <><Loader size={12} className="animate-spin" /> Creating…</>
              : <><Layers size={12} /> Create Style</>}
          </button>
        </div>
      </div>
    </div>
  )
}
