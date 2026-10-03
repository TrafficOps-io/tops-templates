import { createContext, useContext, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Code2, Download, FileArchive, FolderOpen, LayoutTemplate, MonitorDown, Sparkles } from 'lucide-react';
import BrandMark from './BrandMark.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { getInstallPrompt, installStudio, subscribeInstall } from './install.js';
import './landing.css';

const workspaceUrl = '/?studio=1';
const ScreenshotTheme = createContext('light');
const InstallContext = createContext(null);
const resolvedTheme = () => document.documentElement.getAttribute('data-theme')?.replace('studio-', '') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function subscribeTheme(listener) {
  const system = matchMedia('(prefers-color-scheme: dark)');
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  system.addEventListener('change', listener);
  return () => { observer.disconnect(); system.removeEventListener('change', listener); };
}
const features = [
  { id: 'templates', icon: LayoutTemplate, label: 'Start with a template', title: 'A starting point, ready to make yours.', text: 'Browse included templates, connect a template repository, or turn your own page into a reusable starting point.', alt: 'Landing Studio template library with three included starter designs' },
  { id: 'editor', icon: Code2, label: 'Make it your own', title: 'Content, code and preview. Together.', text: 'Edit text and images, work directly with source files, and check the result in desktop and mobile previews.', alt: 'The real Landing Studio editor with files, editable content and a live page preview' },
  { id: 'export', icon: FileArchive, label: 'Take it with you', title: 'Your next launch starts with a ZIP.', text: 'Export a ready-to-host HTML site or an editable project archive. Keep a backup and come back to it later.', alt: 'Landing Studio HTML export dialog with download options' },
];

// Screenshots follow the app theme, including a manual override independent of the OS.
function Screenshot({ name, alt, priority = false, className = '' }) {
  const theme = useContext(ScreenshotTheme);
  return <div className={`landing-screenshot ${className}`}>
    <img className={`landing-shot-${theme}`} src={`/marketing/${name}-${theme}.webp`} srcSet={`/marketing/${name}-${theme}-720.webp 720w, /marketing/${name}-${theme}.webp 1440w`} sizes={priority ? '(max-width: 767px) calc(100vw - 40px), (max-width: 1100px) 52vw, 58vw' : '(max-width: 767px) calc(100vw - 66px), (max-width: 1200px) calc(100vw - 124px), 1080px'} alt={alt} width="1440" height="1000" loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" />
  </div>;
}

function FeatureTour() {
  const id = useId(), [selected, setSelected] = useState(0);
  const feature = features[selected];
  function select(index, focus = false) {
    setSelected(index);
    if (focus) document.getElementById(`${id}-${features[index].id}`)?.focus();
  }
  return <section id="features" className="landing-section landing-tour" aria-labelledby="features-title">
    <div className="landing-section-heading"><h2 id="features-title">From a starting point<br />to a page of your own.</h2><p>A practical workspace for the whole process, from the first edit to the files you publish.</p></div>
    <div className="landing-tabs" role="tablist" aria-label="Explore Studio features" onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (selected + 1) % features.length : event.key === 'ArrowLeft' ? (selected + features.length - 1) % features.length : event.key === 'Home' ? 0 : event.key === 'End' ? features.length - 1 : null;
      if (next !== null) { event.preventDefault(); select(next, true); }
    }}>{features.map(({ id: key, label, icon: Icon }, index) => <button key={key} id={`${id}-${key}`} type="button" role="tab" aria-selected={selected === index} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1} onClick={() => select(index)}><Icon size={19} strokeWidth={1.75} aria-hidden="true" />{label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${feature.id}`} tabIndex={0} className="landing-tour-panel">
      <div className="landing-tour-copy"><h3>{feature.title}</h3><p>{feature.text}</p></div>
      <Screenshot name={feature.id} alt={feature.alt} />
    </div>
    <div className="landing-ai-note"><Sparkles size={24} strokeWidth={1.75} aria-hidden="true" /><div><h3>Bring an assistant when you need one.</h3><p>Connect your OpenRouter key to draft pages, rewrite content and generate images. AI is optional and uses an external service.</p></div></div>
  </section>;
}

function InstallButton({ location, compact = false }) {
  const { busy, install } = useContext(InstallContext);
  return <button type="button" className={`landing-button landing-primary${compact ? ' landing-small' : ''}`} onClick={() => install(location)} disabled={busy} aria-label={compact ? 'Install Studio' : undefined}>
    {!compact && <MonitorDown size={18} aria-hidden="true" />}{busy ? 'Installing…' : compact ? 'Install' : 'Install Studio'}
  </button>;
}

function InstallActions({ location }) {
  const { status } = useContext(InstallContext);
  return <div className="landing-cta">
    <div className="landing-action-row"><InstallButton location={location} /><a href={workspaceUrl} className="landing-text-link">Use in browser</a></div>
    <p className="landing-install-status" role="status">{status.location === location ? status.message : ''}</p>
  </div>;
}

function InstallSection() {
  const { guide } = useContext(InstallContext);
  return <section id="install" className="landing-section landing-install" aria-labelledby="install-title">
    <div className="landing-install-heading"><img src="/pwa-icon-192.png" width="88" height="88" alt="Landing Studio app icon" loading="lazy" /><div><h2 id="install-title">A place on your desktop.</h2><p>Install Studio as a PWA. Launch straight into your projects and templates, in a window of its own.</p></div><InstallActions location="section" /></div>
    <div className="landing-install-body"><Screenshot name="projects" alt="Landing Studio project library, the starting screen of the installed app" /><div className="landing-install-notes"><h3>Open it. Get back to work.</h3><p>Your library opens first, so you can choose the project you want to work on.</p><h3>Keep editing offline.</h3><p>After the first load finishes, cached app files and included templates are available offline. AI and new repositories need a connection.</p><details ref={guide} className="landing-install-guide"><summary>Installation for your browser</summary><dl><dt>Chrome or Edge</dt><dd>Use Install Studio when prompted, or choose the install icon in the address bar.</dd><dt>Safari on Mac</dt><dd>Choose File, then Add to Dock.</dd><dt>iPhone or iPad</dt><dd>In Safari, open Share, then Add to Home Screen.</dd></dl><p>If your browser does not offer installation, <a href={workspaceUrl}>use Studio in your browser</a>.</p></details></div></div>
  </section>;
}

export default function LandingPage() {
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme);
  const prompt = useSyncExternalStore(subscribeInstall, getInstallPrompt);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState({});
  const guide = useRef(null);
  function showInstallGuide() {
    guide.current.open = true;
    guide.current.querySelector('summary').focus({ preventScroll: true });
    guide.current.scrollIntoView({ block: 'center' });
  }
  async function install(location) {
    if (!prompt) { showInstallGuide(); return; }
    setBusy(true); setStatus({});
    try {
      const result = await installStudio();
      setStatus({ location, message: result?.outcome === 'accepted'
        ? 'Installation accepted. Open Landing Studio from your device’s app launcher once it is ready.'
        : 'Installation dismissed. You can install later from your browser menu, or use Studio in this tab.' });
    } catch {
      setStatus({ location: 'section', message: 'Installation could not start. Follow the steps below, or use Studio in your browser.' });
      showInstallGuide();
    } finally { setBusy(false); }
  }
  return <ScreenshotTheme.Provider value={theme}><InstallContext.Provider value={{ busy, status, install, guide }}><div className="studio-root landing-page">
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <header className="landing-header"><div className="landing-container landing-nav"><a className="landing-brand" href="/"><BrandMark /><span>Landing Studio<small>by trafficops.io</small></span></a><nav aria-label="Main navigation"><a href="#features">Features</a><a href="#local">Local by design</a><a href="#install">Install</a></nav><div className="landing-nav-actions"><ThemeToggle /><InstallButton location="hero" compact /></div></div></header>
    <main id="landing-main" className="landing-container" tabIndex={-1}>
      <section className="landing-hero" aria-labelledby="landing-title"><div className="landing-hero-copy"><p className="landing-intro">The landing page studio. Built as a PWA.</p><h1 id="landing-title">Your landing.<br />Your workspace.</h1><p className="landing-lede">Install your own workspace to build from templates, edit with a live preview, and export your site. Your projects stay on your device.</p><div className="landing-hero-actions"><InstallActions location="hero" /></div></div><Screenshot name="editor" alt="Landing Studio showing the source files, editable page content and live preview of a product landing" priority className="landing-hero-visual" /></section>
      <FeatureTour />
      <section id="local" className="landing-section landing-local" aria-labelledby="local-title"><div className="landing-local-heading"><h2 id="local-title">Your files live<br />where you work.</h2><p>No account needed. Create and manage projects locally, without uploading them to a Studio server.</p></div><img className="landing-local-art" src="/marketing/local-files.webp" width="1536" height="1024" loading="lazy" alt="A folder of page designs beside an external drive, illustrating local file ownership" /><div className="landing-local-details"><article><FolderOpen size={24} strokeWidth={1.75} aria-hidden="true" /><h3>A folder you control.</h3><p>In Chrome and Edge, work in folders on your computer. Other supported browsers keep projects in local browser storage.</p></article><article><Download size={24} strokeWidth={1.75} aria-hidden="true" /><h3>A backup you can take.</h3><p>Export an editable ZIP to move a project or keep a copy. Clearing site data removes projects stored in the browser.</p></article></div></section>
      <InstallSection />
      <section className="landing-section landing-faq" aria-labelledby="faq-title"><div><h2 id="faq-title">Before you start.</h2><a className="landing-text-link" href="https://trafficops-io.github.io/tops-templates/" target="_blank" rel="noreferrer">Read the documentation</a></div><div className="landing-questions"><details><summary>Do I need an account or an AI key?</summary><p>No account is needed to edit or export a page. An OpenRouter key is only needed if you choose to use AI features.</p></details><details><summary>Are my projects uploaded anywhere?</summary><p>Studio stores your projects locally. When you ask AI to help, the relevant prompt, content and attachments are sent to OpenRouter. Loading external templates and remote page assets also uses the network.</p></details><details><summary>Does Studio host my landing page?</summary><p>Studio exports the files. Download a ready-to-host HTML ZIP, then publish it with your own hosting provider.</p></details><details><summary>Will my projects sync between devices?</summary><p>There is no automatic cloud sync. Export an editable project ZIP and import it on another device. Keep regular backups of projects stored in the browser.</p></details></div></section>
      <section className="landing-closing" aria-labelledby="closing-title"><h2 id="closing-title">Make room for your next idea.</h2><InstallActions location="closing" /></section>
    </main>
    <footer className="landing-container landing-footer"><a className="landing-brand" href="https://trafficops.io/" target="_blank" rel="noreferrer"><BrandMark /><span>Landing Studio<small>by trafficops.io</small></span></a><p>Built for local work. Open source.</p><a href="https://github.com/trafficops-io/tops-templates" target="_blank" rel="noreferrer">Source on GitHub</a></footer>
  </div></InstallContext.Provider></ScreenshotTheme.Provider>;
}
