import { ArrowDownToLine, ChevronDown, FolderOpen, HelpCircle, KeyRound, LayoutGrid, Plus, ShieldCheck, WifiOff } from 'lucide-react';
import { Menu } from '@trafficops/studio-ui/primitives';
import ThemeToggle from './ThemeToggle.jsx';

/** The site header shown around the library and in a browser tab. */
export function AppHeader({ installPrompt, onInstall, onHelp, themeToggle }) {
  return <header className="topbar"><div className="topbar-inner">
    <a className="brand" href="https://trafficops.io/" target="_blank" rel="noreferrer" aria-label="TrafficOps website"><img src="/favicon.svg" alt="" /><span className="brand-wordmark">Traffic<span>Ops</span></span></a>
    <span className="brand-divider" /><span className="product-name">Landing Studio</span>
    <div className="topbar-right">
      <span className="privacy"><ShieldCheck size={15} />Local by design</span>
      {installPrompt && <button className="btn btn-ghost btn-sm" onClick={onInstall}><ArrowDownToLine size={15} />Install Studio</button>}
      <button className="btn btn-ghost btn-sm" aria-label="Open quick start guide" onClick={onHelp}><HelpCircle size={16} />Quick start</button>
      {themeToggle && <ThemeToggle />}
      <a className="docs-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Docs ↗</a>
    </div>
  </div></header>;
}

/** OpenRouter settings, PWA and network state, the update button and the App error. */
export function StatusNotices({ blocked, blockedReason, pwa, online, update, error, onAiSettings, onUpdate, onDismissError }) {
  return <>
    <button type="button" className="btn btn-ghost btn-sm" disabled={blocked} title={blocked ? blockedReason : 'OpenRouter'} onClick={onAiSettings}><KeyRound size={15} /><span className="studio-navigation-label">OpenRouter</span></button>
    {pwa.error && <span className="studio-app-error" role="status">{pwa.error.operation === 'register' ? 'Offline setup failed' : 'Update check failed'}: {pwa.error.message}</span>}
    {!online && <span className="studio-network" role="status"><WifiOff size={14} />Offline · local editing available</span>}
    {update && <button className="btn btn-primary btn-sm" disabled={blocked} title={blocked ? blockedReason : undefined} onClick={onUpdate}>Update Studio</button>}
    {error && <span className="studio-app-error" role="alert">{error}<button className="text-link" onClick={onDismissError}>Dismiss</button></span>}
  </>;
}

/** Switches to another listed project. Menu items are buttons, so a permission prompt runs in their click (spec A8). */
export function ProjectMenu({ projects, current, activity, disabled, onOpen }) {
  const label = current?.name || 'Switch project';
  return <Menu label="Switch project" className="studio-project-menu" triggerClassName="btn btn-ghost btn-sm" disabled={disabled} trigger={<><span className="studio-navigation-label">{label}</span><ChevronDown size={14} /></>}>
    {({ close }) => projects.map(entry => <button type="button" role="menuitem" key={entry.projectId} aria-current={entry.projectId === current?.projectId ? 'true' : undefined} disabled={entry.projectId === current?.projectId} onClick={() => { close(false); onOpen(entry); }}>
      <strong>{entry.name}</strong>{activity.some(run => run.projectId === entry.projectId) && <small>AI working</small>}
    </button>)}
  </Menu>;
}

/** The editor's App navigation (shell `projectSwitcher` slot): library, new project, switcher, folder state. */
export function ProjectNavigation({ blocked, blockedReason, busy, lost, conflict, projects, current, activity, help, notices, onLibrary, onNewProject, onOpen, onReconnect, onSaveCopy }) {
  const title = text => blocked ? blockedReason : text;
  return <div className="studio-navigation">
    <button className="btn btn-ghost btn-sm" disabled={blocked} title={title('Projects')} onClick={onLibrary}><LayoutGrid size={16} /><span className="studio-navigation-label">Projects</span></button>
    <button className="btn btn-ghost btn-sm" disabled={blocked} title={title('New project')} onClick={onNewProject}><Plus size={16} /><span className="studio-navigation-label">New project</span></button>
    {current && projects.length > 1 && <ProjectMenu projects={projects} current={current} activity={activity} disabled={blocked} onOpen={onOpen} />}
    {lost && <span className="folder-unavailable" role="alert" title={lost}>Folder unavailable<button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onReconnect}><FolderOpen size={14} />Reconnect</button></span>}
    {(lost || conflict) && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onSaveCopy}>Save a copy…</button>}
    {notices}{help}<ThemeToggle />
  </div>;
}
