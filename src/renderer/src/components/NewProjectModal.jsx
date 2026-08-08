import { useState, useEffect, useRef } from 'react'
import { FolderPlus, Folder, Loader, X, Copy, Check } from 'lucide-react'

// Minimal "create a project folder hierarchy" prompt. No folder-tree browser —
// just a name + a location, then it scaffolds the standard sub-folder tree on
// disk via window.api.createProject. There is no "active project" concept.
export default function NewProjectModal({ onClose }) {
  const [name, setName]         = useState('')
  const [parentPath, setParent] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState(null)
  const [doneAt, setDoneAt]     = useState(null)   // created project path
  const [copied, setCopied]     = useState(false)
  const nameRef = useRef(null)

  const copyPath = () => {
    if (!doneAt) return
    navigator.clipboard.writeText(doneAt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  useEffect(() => { nameRef.current?.focus() }, [])

  const browse = async () => {
    setError(null)
    const res = await window.api.selectFolder()
    if (res?.success && res.data) setParent(res.data)
  }

  const create = async () => {
    setError(null)
    if (!parentPath) { setError('Choose where to create the project.'); return }
    if (!name.trim()) { setError('Enter a project name.'); return }
    setCreating(true)
    try {
      const res = await window.api.createProject({ parentPath, projectName: name.trim() })
      if (res?.success) {
        setDoneAt(res.data)
      } else {
        setError(res?.error || 'Failed to create project.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !creating && !doneAt) create()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="w-[420px] rounded-xl bg-c-surface border border-c-border shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-c-text">
            <FolderPlus size={16} className="text-c-accent" />
            <h2 className="text-sm font-semibold">New Project</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-c-text-3 hover:text-c-text hover:bg-c-raised transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {doneAt ? (
          <div className="space-y-4">
            <p className="text-xs text-c-text-2">
              Project folder tree created at:
            </p>
            <div className="flex items-stretch gap-2">
              <p className="flex-1 min-w-0 text-[11px] font-mono break-all text-c-text bg-c-base rounded-md px-3 py-2 border border-c-border">
                {doneAt}
              </p>
              <button
                onClick={copyPath}
                title={copied ? 'Copied!' : 'Copy path'}
                className={`flex-shrink-0 flex items-center justify-center w-9 rounded-md border transition-colors
                  ${copied
                    ? 'bg-green-500/15 border-green-500/40 text-green-400'
                    : 'bg-c-raised border-c-border-2 text-c-text-2 hover:bg-c-hover hover:text-c-text'
                  }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-c-accent text-c-on-accent hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="block text-[11px] text-c-text-3 mb-1">Project name</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 0000.MyProject"
                className="w-full px-3 py-2 rounded-lg text-xs bg-c-base border border-c-border
                  text-c-text placeholder-c-text-4 focus:outline-none focus:border-c-accent transition-colors"
              />
            </div>

            {/* Location */}
            <div>
              <label className="block text-[11px] text-c-text-3 mb-1">Location</label>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0 px-3 py-2 rounded-lg text-[11px] bg-c-base border border-c-border
                  text-c-text-2 truncate" title={parentPath || 'No folder chosen'}>
                  {parentPath || <span className="text-c-text-4">No folder chosen</span>}
                </div>
                <button
                  onClick={browse}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                    bg-c-raised text-c-text-2 border border-c-border-2 hover:bg-c-hover hover:text-c-text transition-colors"
                >
                  <Folder size={13} /> Browse
                </button>
              </div>
            </div>

            {error && <p className="text-[11px] text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-c-text-2 hover:bg-c-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={creating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  bg-c-accent text-c-on-accent hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {creating ? <Loader size={13} className="animate-spin" /> : <FolderPlus size={13} />}
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
