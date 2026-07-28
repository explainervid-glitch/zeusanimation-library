import { useState, useEffect, useCallback } from 'react'
import {
  Folder, FolderOpen, Film, Shapes, Image as ImageIcon, Music,
  ChevronRight, ChevronDown, Check,
} from 'lucide-react'

// Symbol types the user can actually import as an animated symbol.
// ('symbol' is the disk reader's generic fallback when the subtype is unknown.)
export const SELECTABLE = new Set(['graphic', 'movie clip', 'button', 'symbol'])

// Per-type leaf icon.
export function TypeIcon({ type, size = 12 }) {
  if (type === 'movie clip') return <Film size={size} className="text-c-accent flex-shrink-0" />
  if (type === 'graphic')    return <Shapes size={size} className="text-c-accent flex-shrink-0" />
  if (type === 'button')     return <Shapes size={size} className="text-c-accent flex-shrink-0" />
  if (type === 'symbol')     return <Shapes size={size} className="text-c-accent flex-shrink-0" />
  if (type === 'bitmap')     return <ImageIcon size={size} className="text-c-text-4 flex-shrink-0" />
  if (type === 'sound')      return <Music size={size} className="text-c-text-4 flex-shrink-0" />
  return <Shapes size={size} className="text-c-text-4 flex-shrink-0" />
}

// ── Build a folder tree from Animate's flat, path-encoded library list ──
// Animate encodes an item's folder path in its name ("Folder/Sub/Symbol") and
// lists folders as items too, so the flat list fully describes the hierarchy.
export function buildTree(items) {
  const root = { name: '', path: '', type: 'folder', children: [], _map: {} }
  const ensureFolder = (parts) => {
    let node = root, acc = []
    for (const part of parts) {
      acc.push(part)
      const key = acc.join('/')
      if (!node._map[key]) {
        const f = { name: part, path: key, type: 'folder', children: [], _map: {} }
        node._map[key] = f
        node.children.push(f)
      }
      node = node._map[key]
    }
    return node
  }
  for (const it of items) {
    const parts = it.path.split('/')
    if (it.type === 'folder') { ensureFolder(parts); continue }
    const parent = ensureFolder(parts.slice(0, -1))
    parent.children.push({ name: parts[parts.length - 1], path: it.path, type: it.type, children: null })
  }
  // Folders first, then alpha — mirrors Animate's Library panel ordering.
  const sortRec = (node) => {
    if (!node.children) return
    node.children.sort((a, b) => {
      const af = a.type === 'folder', bf = b.type === 'folder'
      if (af !== bf) return af ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    node.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}

// ── One tree row (folder = expandable, leaf = selectable) ──
function TreeNode({ node, depth, expanded, toggleExpand, selected, onSelect, dense }) {
  const pad  = { paddingLeft: (dense ? 4 : 8) + depth * (dense ? 11 : 14) }
  const text = dense ? 'text-[10px]' : 'text-[11px]'
  const row  = dense ? 'py-0.5' : 'py-1'

  if (node.type === 'folder') {
    const open = expanded.has(node.path)
    return (
      <>
        <button
          onClick={() => toggleExpand(node.path)}
          style={pad}
          className={`w-full flex items-center gap-1.5 ${row} pr-2 rounded-md text-left
            text-c-text-2 hover:bg-c-hover hover:text-c-text transition-colors`}
        >
          {open ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
          {open ? <FolderOpen size={13} className="text-c-text-3 flex-shrink-0" /> : <Folder size={13} className="text-c-text-3 flex-shrink-0" />}
          <span className={`${text} font-medium truncate`}>{node.name}</span>
        </button>
        {open && node.children.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1}
            expanded={expanded} toggleExpand={toggleExpand}
            selected={selected} onSelect={onSelect} dense={dense} />
        ))}
      </>
    )
  }

  // Leaf (symbol / bitmap / sound)
  const selectable = SELECTABLE.has(node.type)
  const isSel = selected === node.path
  return (
    <button
      onClick={() => selectable && onSelect(node.path)}
      disabled={!selectable}
      style={pad}
      className={`w-full flex items-center gap-1.5 ${row} pr-2 rounded-md text-left transition-colors
        ${isSel ? 'bg-c-accent text-c-on-accent'
          : selectable ? 'text-c-text-2 hover:bg-c-hover hover:text-c-text'
          : 'text-c-text-4 cursor-not-allowed'}`}
      title={selectable ? node.path : `${node.type} — not a symbol`}
    >
      <span className="w-3 flex-shrink-0" />
      <TypeIcon type={node.type} />
      <span className={`${text} truncate flex-1`}>{node.name}</span>
      {isSel && <Check size={11} className="flex-shrink-0" />}
    </button>
  )
}

// ── PUBLIC: the whole tree, with its own expand/collapse state ──
// Folders start COLLAPSED; state resets whenever `items` changes.
export default function FlaLibraryTree({ items, selected, onSelect, dense = false }) {
  const [expanded, setExpanded] = useState(new Set())

  useEffect(() => { setExpanded(new Set()) }, [items])

  const toggleExpand = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  const tree = buildTree(items || [])
  return tree.children.map((node) => (
    <TreeNode key={node.path} node={node} depth={0}
      expanded={expanded} toggleExpand={toggleExpand}
      selected={selected} onSelect={onSelect} dense={dense} />
  ))
}
