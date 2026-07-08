import { FolderGit2, FolderOpen, X } from 'lucide-react'
import useProjectStore from '../store/useProjectStore'

// Derive the folder name from a full path (Windows or POSIX separators).
function baseName(p) {
  return p ? p.split(/[\\/]/).filter(Boolean).pop() : ''
}

// Persistent status bar showing the active project. Clicking the name opens the
// project folder; "Change" picks a different existing project folder.
export default function BottomBar() {
  const { activeProject, setActiveProject, clearActiveProject } = useProjectStore()

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
    <footer className="h-7 flex items-center gap-2 px-3 flex-shrink-0 select-none
      bg-c-surface border-t border-c-border text-[11px]">
      <FolderGit2 size={12} className="text-c-accent flex-shrink-0" />

      {activeProject ? (
        <>
          <span className="text-c-text-4 flex-shrink-0">Project:</span>
          <button
            onClick={handleOpen}
            title={`Open ${activeProject.path}`}
            className="flex items-center gap-1 text-c-text font-medium
              hover:text-c-accent transition-colors truncate max-w-[280px]"
          >
            <span className="truncate">{activeProject.name}</span>
            <FolderOpen size={11} className="flex-shrink-0 opacity-60" />
          </button>
          <span className="text-c-text-4 truncate hidden sm:inline" title={activeProject.path}>
            {activeProject.path}
          </span>

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleSelect}
              className="text-c-text-4 hover:text-c-text transition-colors"
              title="Switch to another project folder"
            >
              Change
            </button>
            <button
              onClick={clearActiveProject}
              className="text-c-text-4 hover:text-c-text transition-colors"
              title="Clear active project"
            >
              <X size={12} />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-c-text-4">No active project</span>
          <button
            onClick={handleSelect}
            className="ml-auto text-c-accent hover:text-c-accent-h font-medium transition-colors flex-shrink-0"
            title="Pick a project folder"
          >
            Select project
          </button>
        </>
      )}
    </footer>
  )
}
