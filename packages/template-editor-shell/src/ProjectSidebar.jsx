import Menu from './Menu.jsx';
import { useStudioText } from './studio-i18n.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, FileCode2, FileImage, FilePlus2, Files, Folder, FolderOpen, FolderPlus, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { isTemplate, projectFolders } from './project.js';

function FileChange({ path, changes, aiPreview }) {
  const t = useStudioText();
  const kind = changes[path];
  if (!kind) return null;
  const label = `${aiPreview ? t("AI change, not applied") : t("Unsaved changes")}: ${path}${kind === 'added' ? ' (new file)' : ''}`;
  return <span className={`file-change ${aiPreview ? 'ai-change' : ''}`} title={label} role="img" aria-label={label}>{kind === 'added' ? '+' : '●'}</span>;
}

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

function TreeNode({ node, depth, active, changedFiles, aiPreview, collapsed, locked, onToggle, onSelect, onMove, onUpload, onDeleteFolder, dropTarget, setDropTarget }) {
  const t = useStudioText();
  const entries = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {entries.map(folder => {
      const isCollapsed = collapsed.has(folder.path), isOver = dropTarget === folder.path;
      return <div key={folder.path}>
        <div className="folder-entry"><button type="button" className={`file-row folder-row ${isOver ? 'drop-target' : ''}`} style={{ '--tree-depth': depth }} draggable={!locked}
          onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-project-entry', JSON.stringify({ type: 'folder', path: folder.path })); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move'; setDropTarget(folder.path); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}
          onDrop={event => { event.preventDefault(); event.stopPropagation(); setDropTarget(null); event.dataTransfer.files.length ? onUpload(event.dataTransfer.files, folder.path) : onMove(event.dataTransfer.getData('application/x-project-entry'), folder.path); }}
          onClick={() => onToggle(folder.path)} aria-expanded={!isCollapsed}>
          <ChevronRight size={12} className={`folder-chevron ${isCollapsed ? '' : 'expanded'}`} />
          {isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}<span className="file-name">{folder.name}</span>
        </button>{onDeleteFolder && <button type="button" className="btn btn-ghost btn-xs btn-square folder-delete" disabled={locked} title={t('Delete folder')} aria-label={t('Delete folder {path}', { path: folder.path })} onClick={() => onDeleteFolder(folder.path)}><Trash2 size={13} /></button>}</div>
        {!isCollapsed && <TreeNode node={folder} depth={depth + 1} active={active} changedFiles={changedFiles} aiPreview={aiPreview} collapsed={collapsed} locked={locked} onToggle={onToggle} onSelect={onSelect} onMove={onMove} onUpload={onUpload} onDeleteFolder={onDeleteFolder} dropTarget={dropTarget} setDropTarget={setDropTarget} />}
      </div>;
    })}
    {node.files.map(file => <button type="button" className={`file-row ${file.path === active ? 'active' : ''}`} style={{ '--tree-depth': depth }} title={file.path} key={file.path} draggable={!locked}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-project-entry', JSON.stringify({ type: 'file', path: file.path })); }}
      onClick={() => onSelect(file.path)}><span className={`file-icon ${isTemplate(file.path) ? 'template-icon' : ''}`}>{IMAGE_FILE.test(file.path) ? <FileImage size={15} /> : <FileCode2 size={15} />}</span><span className="file-name">{file.name}</span><FileChange path={file.path} changes={changedFiles} aiPreview={aiPreview} /></button>)}
  </>;
}

function CollapsedTree({ node, depth = 0, active, changedFiles, aiPreview, onSelect, onExpand }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  return <>
    {folders.map(folder => <div className="collapsed-tree-group" key={folder.path}>
      <button type="button" className="collapsed-file-button" style={{ '--tree-depth': depth }} title={folder.path} aria-label={`Open project files at ${folder.path}`} onClick={onExpand}><Folder size={17} /></button>
      <CollapsedTree node={folder} depth={depth + 1} active={active} changedFiles={changedFiles} aiPreview={aiPreview} onSelect={onSelect} onExpand={onExpand} />
    </div>)}
    {node.files.map(file => <button type="button" className={`collapsed-file-button ${file.path === active ? 'active' : ''}`} style={{ '--tree-depth': depth }} title={file.path} aria-label={`Open ${file.path}`} key={file.path} onClick={() => onSelect(file.path)}>
      {IMAGE_FILE.test(file.path) ? <FileImage size={17} /> : <FileCode2 size={17} />}<FileChange path={file.path} changes={changedFiles} aiPreview={aiPreview} />
    </button>)}
  </>;
}

export default function ProjectSidebar({ files, folders, active, changedFiles = {}, aiPreview = false, locked = false, aiEnabled = false, projectName = 'session-project', savesToDisk = false, storageSummary = '', storageHelp = '', isCollapsed, onToggleCollapsed, onManageProjects, onOpenArchive, onSelect, onCreate, onRename, onDelete, onDeleteFolder, onMove, onUpload, onExport }) {
  const t = useStudioText();
  const [collapsed, setCollapsed] = useState(new Set());
  const [dropTarget, setDropTarget] = useState(null);
  const uploadInput = useRef(null);
  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  const toggle = path => setCollapsed(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; });
  const handleMove = (payload, target) => { if (locked || !payload) return; try { onMove(JSON.parse(payload), target); } catch { /* malformed browser drag data */ } };
  return <aside className={`file-sidebar ${isCollapsed ? 'is-collapsed' : ''}`} aria-label={t("Project files panel")}>
    <div className="panel-heading"><span title={isCollapsed ? t("Project files") : undefined}><Files size={15} /><span className="panel-heading-label">{t("PROJECT FILES")}</span></span><div className="sidebar-heading-actions">{onManageProjects && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label="Manage project folders" title="Project folders" onClick={onManageProjects}><FolderOpen size={15} /></button>}{!isCollapsed && <button type="button" className="btn btn-ghost btn-xs btn-square" aria-label={t("Open template ZIP")} title={t("Open ZIP")} disabled={locked} onClick={onOpenArchive}><ArrowUpFromLine size={15} /></button>}{!isCollapsed && <Menu className="create-menu" triggerClassName="btn btn-ghost btn-xs btn-square" disabled={locked} label={t("Create file or folder")} trigger={<Plus size={15} />}>{({ close }) => <><button role="menuitem" type="button" onClick={() => { close(); onCreate('file'); }}><FilePlus2 size={14} />{t("New file")}</button><button role="menuitem" type="button" onClick={() => { close(); onCreate('folder'); }}><FolderPlus size={14} />{t("New folder")}</button></>}</Menu>}<button type="button" className="btn btn-ghost btn-xs btn-square sidebar-collapse" aria-label={isCollapsed ? t("Expand project files") : t("Collapse project files")} aria-expanded={!isCollapsed} onClick={onToggleCollapsed}>{isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button></div></div>
    {isCollapsed ? <nav className="collapsed-file-tree" aria-label={t("Project file shortcuts")}>
      <button type="button" className="collapsed-file-button project-root-button" title={projectName} aria-label={`Expand ${projectName} project files`} onClick={onToggleCollapsed}><FolderOpen size={17} /></button>
      <CollapsedTree node={tree} active={active} changedFiles={changedFiles} aiPreview={aiPreview} onSelect={onSelect} onExpand={onToggleCollapsed} />
    </nav> : <>
      <div className={`project-folder ${dropTarget === '' ? 'drop-target' : ''}`} onDragOver={event => { event.preventDefault(); setDropTarget(''); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} onDrop={event => { event.preventDefault(); setDropTarget(null); event.dataTransfer.files.length ? onUpload(event.dataTransfer.files, '') : handleMove(event.dataTransfer.getData('application/x-project-entry'), ''); }}><FolderOpen size={15} /><span title={projectName}>{projectName}</span><span className="count">{Object.keys(files).length}</span></div>{Object.keys(changedFiles).length > 0 && <div className="file-changes-label" role="status">{Object.keys(changedFiles).length} {aiPreview ? t("AI changes to review") : savesToDisk ? t("files waiting to save") : t("files changed since export")}</div>}
      <nav className="file-tree" aria-label={t("Project files")}><TreeNode node={tree} depth={0} active={active} changedFiles={changedFiles} aiPreview={aiPreview} collapsed={collapsed} locked={locked} onToggle={toggle} onSelect={onSelect} onMove={handleMove} onUpload={onUpload} onDeleteFolder={onDeleteFolder} dropTarget={dropTarget} setDropTarget={setDropTarget} /></nav>
      <div className="file-actions"><button className="btn btn-ghost btn-xs" disabled={locked || !active} onClick={onRename}><Pencil size={12} /> {t("Rename")}</button><button className="btn btn-ghost btn-xs" disabled={locked || !active} onClick={onDelete}><Trash2 size={12} /> {t("Delete")}</button></div>
      <button type="button" disabled={locked} className="sidebar-upload" onClick={() => uploadInput.current?.click()} onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('dragging'); }} onDragLeave={event => event.currentTarget.classList.remove('dragging')} onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); onUpload(event.dataTransfer.files, ''); }}><UploadCloud size={17} /><span><strong>{t("Drop files here")}</strong><small>{t("or choose from your computer")}</small></span></button>
      <input ref={uploadInput} hidden type="file" multiple onChange={event => { onUpload(event.target.files, ''); event.target.value = ''; }} />
      <div className="sidebar-footer"><div className="local-mark"><ShieldCheck size={16} /><strong>{storageSummary || t('Project files')}</strong></div><p>{storageHelp || t('Save to keep your changes.')}</p><button className="btn btn-outline btn-sm source-export" disabled={locked} onClick={onExport}><ArrowDownToLine size={14} /> {t("Export project")}</button></div>
    </>}
  </aside>;
}
