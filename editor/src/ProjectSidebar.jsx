import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronRight, FileCode2, FileImage, FilePlus2, Files, Folder, FolderOpen, FolderPlus, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { isTemplate, projectFolders } from './project.js';

const IMAGE_FILE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

function buildTree(files, explicitFolders) {
  const root = { folders: new Map(), files: [] };
  for (const path of projectFolders(files, explicitFolders)) {
    let node = root, current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: current, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
  }
  for (const path of Object.keys(files).sort((a, b) => a.localeCompare(b))) {
    const parts = path.split('/'), name = parts.pop();
    let node = root, current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: current, folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push({ name, path });
  }
  return root;
}

function TreeNode({ node, depth, active, collapsed, onToggle, onSelect, onMove, onUpload, dropTarget, setDropTarget }) {
  const entries = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {entries.map(folder => {
      const isCollapsed = collapsed.has(folder.path), isOver = dropTarget === folder.path;
      return <div key={folder.path}>
        <button type="button" className={`file-row folder-row ${isOver ? 'drop-target' : ''}`} style={{ '--tree-depth': depth }} draggable
          onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-project-entry', JSON.stringify({ type: 'folder', path: folder.path })); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'; setDropTarget(folder.path); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
          onDrop={event => { event.preventDefault(); event.stopPropagation(); setDropTarget(null); event.dataTransfer.files.length ? onUpload(event.dataTransfer.files, folder.path) : onMove(event.dataTransfer.getData('application/x-project-entry'), folder.path); }}
          onClick={() => onToggle(folder.path)} aria-expanded={!isCollapsed}>
          <ChevronRight size={12} className={`folder-chevron ${isCollapsed ? '' : 'expanded'}`} />
          {isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}<span className="file-name">{folder.name}</span>
        </button>
        {!isCollapsed && <TreeNode node={folder} depth={depth + 1} active={active} collapsed={collapsed} onToggle={onToggle} onSelect={onSelect} onMove={onMove} onUpload={onUpload} dropTarget={dropTarget} setDropTarget={setDropTarget} />}
      </div>;
    })}
    {node.files.map(file => <button type="button" className={`file-row ${file.path === active ? 'active' : ''}`} style={{ '--tree-depth': depth }} title={file.path} key={file.path} draggable
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-project-entry', JSON.stringify({ type: 'file', path: file.path })); }}
      onClick={() => onSelect(file.path)}><span className={`file-icon ${isTemplate(file.path) ? 'template-icon' : ''}`}>{IMAGE_FILE.test(file.path) ? <FileImage size={15} /> : <FileCode2 size={15} />}</span><span className="file-name">{file.name}</span>{file.path === active && <span className="active-dot" />}</button>)}
  </>;
}

export default function ProjectSidebar({ files, folders, active, isCollapsed, onToggleCollapsed, onSelect, onCreate, onRename, onDelete, onMove, onUpload, onExport }) {
  const [collapsed, setCollapsed] = useState(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const uploadInput = useRef(null);
  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  useEffect(() => { if (isCollapsed) setMenuOpen(false); }, [isCollapsed]);
  const toggle = path => setCollapsed(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; });
  const handleMove = (payload, target) => { if (!payload) return; try { onMove(JSON.parse(payload), target); } catch { /* malformed browser drag data */ } };
  return <aside className={`file-sidebar ${isCollapsed ? 'is-collapsed' : ''}`} aria-label="Project files panel">
    <div className="panel-heading"><span title={isCollapsed ? 'Project files' : undefined}><Files size={15} /><span className="panel-heading-label">PROJECT FILES</span></span><div className="sidebar-heading-actions">{!isCollapsed && <div className="create-menu"><button type="button" className="btn btn-ghost btn-xs btn-square" aria-label="Create file or folder" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><Plus size={15} /></button>{menuOpen && <div className="create-popover"><button type="button" onClick={() => { setMenuOpen(false); onCreate('file'); }}><FilePlus2 size={14} /> New file</button><button type="button" onClick={() => { setMenuOpen(false); onCreate('folder'); }}><FolderPlus size={14} /> New folder</button></div>}</div>}<button type="button" className="btn btn-ghost btn-xs btn-square sidebar-collapse" aria-label={isCollapsed ? 'Expand project files' : 'Collapse project files'} aria-expanded={!isCollapsed} onClick={onToggleCollapsed}>{isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button></div></div>
    {!isCollapsed && <>
      <div className={`project-folder ${dropTarget === '' ? 'drop-target' : ''}`} onDragOver={event => { event.preventDefault(); setDropTarget(''); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={event => { event.preventDefault(); setDropTarget(null); event.dataTransfer.files.length ? onUpload(event.dataTransfer.files, '') : handleMove(event.dataTransfer.getData('application/x-project-entry'), ''); }}><FolderOpen size={15} /><span>my-template</span><span className="count">{Object.keys(files).length}</span></div>
      <nav className="file-tree" aria-label="Project files"><TreeNode node={tree} depth={0} active={active} collapsed={collapsed} onToggle={toggle} onSelect={onSelect} onMove={handleMove} onUpload={onUpload} dropTarget={dropTarget} setDropTarget={setDropTarget} /></nav>
      <div className="file-actions"><button className="btn btn-ghost btn-xs" disabled={!active} onClick={onRename}><Pencil size={12} /> Rename</button><button className="btn btn-ghost btn-xs" disabled={!active} onClick={onDelete}><Trash2 size={12} /> Delete</button></div>
      <button type="button" className="sidebar-upload" onClick={() => uploadInput.current?.click()} onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('dragging'); }} onDragLeave={event => event.currentTarget.classList.remove('dragging')} onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); onUpload(event.dataTransfer.files, ''); }}><UploadCloud size={17} /><span><strong>Drop files here</strong><small>or choose from your computer</small></span></button>
      <input ref={uploadInput} hidden type="file" multiple onChange={event => { onUpload(event.target.files, ''); event.target.value = ''; }} />
      <div className="sidebar-footer"><div className="local-mark"><ShieldCheck size={16} /><strong>Yours, from start to finish.</strong></div><p>Files stay in this browser.<br />Nothing is uploaded.</p><button className="btn btn-outline btn-sm w-full" onClick={onExport}><ArrowDownToLine size={14} /> Save template ZIP</button></div>
    </>}
  </aside>;
}
