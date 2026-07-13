import { useState } from 'react'
import { FolderGit2, FolderOpen, X, FolderPlus } from 'lucide-react'
import useProjectStore from '../store/useProjectStore'
import AddProjectModal from './Toolbar/AddProjectModal'

// Derive the folder name from a full path (Windows or POSIX separators).
function baseName(p) {
  return p ? p.split(/[\\/]/).filter(Boolean).pop() : ''
}

// Persistent status bar: active project on the left, "Add Project" in the
// center, project actions on the right.
export default function BottomBar() {
  const { activeProject, setActiveProject, clearActiveProject } = useProjectStore()
  const [showProjectModal, setShowProjectModal] = useState(false)

  const handleSelect = async () => {
    const result = await window.api.selectFolder()
    if (result?.success) {
      setActiveProject({ name: baseName(result.data), path: result.data })
    }
  }

  const handleOpen = () => {
    if (activeProject?.path) window.api.openPath(activeProject.path)
  }

  return (
    <>
      <footer className="h-12 flex items-center gap-3 px-3 flex-shrink-0
        select-none bg-c-surface border-t border-c-border text-[11px]">

        {/* Left — active project */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FolderGit2 size={13} className="text-c-accent flex-shrink-0" />
          {activeProject ? (
            <>
              <span className="text-c-text-4 flex-shrink-0">Project:</span>
              <button
                onClick={handleOpen}
                title={`Open ${activeProject.path}`}
                className="flex items-center gap-1 min-w-0 text-c-text font-medium
                  hover:text-c-accent transition-colors"
              >
                <span className="truncate">{activeProject.name}</span>
                <FolderOpen size={11} className="flex-shrink-0 opacity-60" />
              </button>
            </>
          ) : (
            <span className="text-c-text-3 truncate">No active project</span>
          )}
        </div>

        {/* Right — project actions (Add Project sits next to Change) */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {activeProject ? (
            <button
              onClick={handleSelect}
              className="text-c-text hover:text-c-text transition-colors flex-shrink-0"
              title="Switch to another existing project folder"
            >
              Change Project
            </button>
          ) : (
            <button
              onClick={handleSelect}
              className="flex items-center px-3 py-1.5 rounded-lg text-xs font-medium
                bg-c-raised border border-c-border-2 text-c-text-2
                hover:bg-c-hover hover:text-c-text transition-all flex-shrink-0"
              title="Pick an existing project folder"
            >
              Select Project
            </button>
          )}

          {!activeProject && (
            <button
              onClick={() => setShowProjectModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                bg-c-accent text-c-on-accent hover:bg-c-accent-h transition-all"
              title="Create a new project folder + structure"
            >
              <FolderPlus size={13} />
              Add Project
            </button>
          )}

          {activeProject && (
            <button
              onClick={clearActiveProject}
              className="text-c-text-4 hover:text-c-text transition-colors flex-shrink-0"
              title="Clear active project"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </footer>

      <AddProjectModal isOpen={showProjectModal} onClose={() => setShowProjectModal(false)} />
    </>
  )
}
