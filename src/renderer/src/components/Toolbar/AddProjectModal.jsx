import { useState, useEffect, useRef } from 'react'
import { X, Check, AlertCircle, FolderOpen, FolderPlus } from 'lucide-react'
import useProjectStore from '../../store/useProjectStore'

// Create a new project folder + its standard sub-folder tree at a chosen location.
export default function AddProjectModal({ isOpen, onClose }) {
  const [name,     setName]     = useState('')
  const [location, setLocation] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [success,  setSuccess]  = useState(false)
  const modalRef = useRef(null)

  // Reset when (re)opened
  useEffect(() => {
    if (isOpen) {
      setName(''); setLocation(''); setError(null); setSuccess(false); setLoading(false)
    }
  }, [isOpen])

  // Click outside + Escape to close — but not while a create is in flight.
  useEffect(() => {
    if (!isOpen) return
    const onMouse = (e) => { if (!loading && modalRef.current && !modalRef.current.contains(e.target)) onClose() }
    const onKey   = (e) => { if (!loading && e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onClose, loading])

  const handleBrowse = async () => {
    const result = await window.api.selectFolder()
    if (result?.success) { setLocation(result.data); setError(null) }
  }

  const canCreate = name.trim() && location.trim() && !loading && !success

  const handleCreate = async () => {
    if (!canCreate) return
    setLoading(true); setError(null)
    try {
      const result = await window.api.createProject({
        parentPath:  location.trim(),
        projectName: name.trim(),
      })
      if (result.success) {
        // Newly created project becomes the active project (shown in bottom bar).
        useProjectStore.getState().setActiveProject({ name: name.trim(), path: result.data })
        setSuccess(true)
        setTimeout(onClose, 1000)
      } else {
        // Duplicate folder or any other failure — cancel + notify.
        setError(result.error || 'Failed to create project.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleCreate() }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-md">
      <div
        ref={modalRef}
        className="bg-c-surface border border-c-border rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <FolderPlus size={16} className="text-c-accent" />
            <h2 className="text-sm font-semibold text-c-text">Create New Project</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-c-text-3 hover:text-c-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Project name */}
          <div>
            <label className="block text-xs font-medium text-c-text-2 mb-1.5">
              Project Name <span className="text-c-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 01945. prabontol"
              disabled={loading || success}
              autoFocus
              className="w-full px-3 py-2 rounded-lg text-xs
                bg-c-raised border border-c-border-2 text-c-text placeholder-c-text-4
                focus:outline-none focus:border-c-accent transition-colors disabled:opacity-50"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-c-text-2 mb-1.5">
              Location <span className="text-c-error">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={location}
                readOnly
                placeholder="Select a location…"
                className="flex-1 px-3 py-2 rounded-lg text-xs
                  bg-c-raised border border-c-border-2 text-c-text placeholder-c-text-4
                  focus:outline-none truncate cursor-default"
                title={location}
              />
              <button
                onClick={handleBrowse}
                disabled={loading || success}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                  bg-c-raised border border-c-border-2 text-c-text hover:border-c-accent/50
                  transition-colors disabled:opacity-50"
              >
                <FolderOpen size={13} /> Browse
              </button>
            </div>
            {location && name.trim() && (
              <p className="text-[10px] text-c-text-4 mt-1.5 truncate" title={`${location}\\${name.trim()}`}>
                Creates: <span className="text-c-text-3">{location}\{name.trim()}</span>
              </p>
            )}
          </div>

          {/* Error / duplicate notification */}
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-c-error-bg/20 border border-c-error/30">
              <AlertCircle size={13} className="text-c-error flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-c-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs text-c-text-3 hover:text-c-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold
                bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all disabled:opacity-50"
            >
              {success ? <><Check size={12} /> Created!</> : loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
