import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FileCode2, LayoutTemplate } from 'lucide-react';
import { Skeleton } from '@trafficops/studio-ui/primitives';
import { resolveImageGeneration } from '@trafficops/template-editor-shell/ai-image-choice';
import { FILE_ATTACHMENT_ACCEPT, FILE_ATTACHMENT_LIMITS, readFileAiAttachments } from '@trafficops/template-editor-shell/file-ai-attachments';
import './home-project-chat.css';

// The chat package (assistant-ui) stays out of the main Studio chunk: the composer loads on first render of a brief.
const StudioComposer = lazy(() => import('@trafficops/studio-ui/chat').then(module => ({ default: module.StudioComposer })));
const BRIEF_ATTACHMENT_LIMITS = Object.freeze({ count: FILE_ATTACHMENT_LIMITS.count, bytesPerFile: FILE_ATTACHMENT_LIMITS.bytes, bytesTotal: FILE_ATTACHMENT_LIMITS.total, accept: FILE_ATTACHMENT_ACCEPT });
// The composer also sends attachments alone; a project brief needs words.
export const BRIEF_REQUIRED = 'Describe the project in the brief.';
const isImage = file => /^image\//.test(file.type || file.mime || '');

/** Composer files (File[]) → the stored brief attachments ({ id, name, mime, dataUrl | text, useOnPage? }). */
export async function briefAttachments(files, useOnPage) {
  if (!files.length) return [];
  return (await readFileAiAttachments(files)).map(item => isImage(item) ? { ...item, useOnPage: Boolean(useOnPage) } : item);
}

/**
 * The project brief composer of the home screen and the New project dialog: StudioComposer without a chat port
 * (no mentions, no scopes) and product options in its `extra` slot — image generation and using attached images on the page.
 * onSubmit({ text, attachments: File[], useOnPage }) may reject or return false to keep the brief.
 */
export function BriefComposer({ value, onChange, attachments, onAttachmentsChange, settings, imageChoice, onImageChoiceChange, useOnPage, onUseOnPageChange, disabled, placeholder, autoFocus, onSubmit }) {
  const images = attachments.some(isImage);
  const extra = <>
    <label className="ai-use-on-page"><input type="checkbox" className="checkbox checkbox-xs" disabled={disabled || !settings?.imageModel} checked={resolveImageGeneration(imageChoice, settings)} onChange={event => onImageChoiceChange(event.target.checked)} />Generate images requested in the brief</label>
    {images && <label className="ai-use-on-page"><input type="checkbox" className="checkbox checkbox-xs" disabled={disabled} checked={useOnPage} onChange={event => onUseOnPageChange(event.target.checked)} />Use attached images on the page</label>}
  </>;
  return <Suspense fallback={<div className="home-brief-loading" aria-busy="true" aria-label="Loading the brief composer"><Skeleton shape="block" height={148} /></div>}>
    <StudioComposer value={value} onChange={onChange} attachments={attachments} onAttachmentsChange={onAttachmentsChange} attachmentLimits={BRIEF_ATTACHMENT_LIMITS}
      scopes={[]} disabled={disabled} placeholder={placeholder} autoFocus={autoFocus} extra={extra}
      onSubmit={({ text, attachments: files }) => onSubmit({ text, attachments: files, useOnPage: images && useOnPage })} />
  </Suspense>;
}

export const briefIdeas = [
  ['Product launch', 'Create a landing page for a new product. Include a clear value proposition, product benefits, social proof, and a strong call to action.'],
  ['Personal portfolio', 'Create a personal portfolio with an introduction, selected projects, an about section, and a contact section.'],
  ['Service business', 'Create a page for a service business with a clear offer, services, customer testimonials, and a contact form.'],
];

export default function HomeProjectChat({ busy, aiSettings, onCreate }) {
  const root = useRef(null), submitting = useRef(false);
  const [kind, setKind] = useState('landing'), [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState([]), [useOnPage, setUseOnPage] = useState(false);
  const [settings, setSettings] = useState(null), [imageChoice, setImageChoice] = useState();
  const [error, setError] = useState(''), [sending, setSending] = useState(false);
  const disabled = busy || sending || settings === null;

  useEffect(() => {
    let alive = true, generation = 0;
    async function load() {
      const current = ++generation;
      try {
        const value = aiSettings ? await aiSettings.load() : {};
        if (alive && current === generation) setSettings({ imageModel: value.imageModel });
      } catch (cause) {
        if (alive && current === generation) { setSettings({}); setError(cause.message); }
      }
    }
    load(); window.addEventListener('trafficops-ai-settings', load);
    return () => { alive = false; window.removeEventListener('trafficops-ai-settings', load); };
  }, [aiSettings]);

  async function submit({ text, attachments: files, useOnPage: onPage }) {
    if (disabled || submitting.current) return false;
    if (!text.trim()) { setError(BRIEF_REQUIRED); return false; }
    submitting.current = true; setSending(true); setError('');
    try {
      // Keep an unspecified image choice unresolved so a model connected in the
      // editor can still become the default for this project's initial brief.
      // The raw files go up: the App opens the folder picker in this submit (spec A8) and reads them afterwards.
      await onCreate({ mode: 'ai', kind, name: '', prompt: text.trim(), attachmentFiles: files, useOnPage: onPage, generateImages: imageChoice });
    } catch (cause) { setError(cause.message); return false; }
    finally { submitting.current = false; setSending(false); }
  }

  function chooseIdea(value) {
    setPrompt(kind === 'template' ? `${value} Make it a reusable template with editable content and images.` : value);
    requestAnimationFrame(() => root.current?.querySelector('textarea')?.focus());
  }

  return <div className="home-project-chat" ref={root}>
    <div className="home-chat-intro">
      <span className="home-chat-kicker">NEW PROJECT / WITH AI</span>
      <h2 id="library-title">Ideas become pages.</h2>
      <p>Describe what you have in mind. Build it together.</p>
    </div>
    <div className="home-chat-kind" role="group" aria-label="Create with AI project type">
      {[["landing", "Landing page", FileCode2], ["template", "Reusable template", LayoutTemplate]].map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={kind === value} disabled={disabled} onClick={() => setKind(value)}><Icon size={15} aria-hidden="true" />{label}</button>)}
    </div>
    <BriefComposer value={prompt} onChange={setPrompt} attachments={attachments} onAttachmentsChange={setAttachments}
      settings={settings} imageChoice={imageChoice} onImageChoiceChange={setImageChoice} useOnPage={useOnPage} onUseOnPageChange={setUseOnPage}
      disabled={disabled} onSubmit={submit} placeholder={kind === 'template' ? 'Describe a reusable template…' : 'Describe your landing page…'} />
    {sending && <p className="home-chat-status" role="status">Creating project…</p>}
    {error && <p className="inline-error home-chat-error" role="alert">{error}</p>}
    <div className="home-chat-ideas" role="group" aria-label="Ideas to get started"><span>Try an idea</span>{briefIdeas.map(([label, value]) => <button type="button" key={label} disabled={disabled || Boolean(prompt.trim())} onClick={() => chooseIdea(value)}>{label}</button>)}</div>
    <p className="home-chat-note">Send your brief to open a new project and continue the conversation.</p>
  </div>;
}
