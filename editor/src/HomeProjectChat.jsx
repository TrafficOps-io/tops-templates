import { useEffect, useRef, useState } from 'react';
import { FileCode2, LayoutTemplate, Sparkles } from 'lucide-react';
import ConversationComposer from '@trafficops/template-editor-shell/ConversationComposer';
import { resolveImageGeneration } from '@trafficops/template-editor-shell/ai-image-choice';
import './home-project-chat.css';

const ideas = [
  ['Product launch', 'Create a landing page for a new product. Include a clear value proposition, product benefits, social proof, and a strong call to action.'],
  ['Personal portfolio', 'Create a personal portfolio with an introduction, selected projects, an about section, and a contact section.'],
  ['Service business', 'Create a page for a service business with a clear offer, services, customer testimonials, and a contact form.'],
];

export default function HomeProjectChat({ busy, aiSettings, onCreate }) {
  const root = useRef(null), submitting = useRef(false);
  const [kind, setKind] = useState('landing'), [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState([]), [readingAttachments, setReadingAttachments] = useState(false);
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

  async function submit() {
    if (disabled || readingAttachments || submitting.current || !prompt.trim()) return;
    submitting.current = true; setSending(true); setError('');
    try {
      // Keep an unspecified image choice unresolved so a model connected in the
      // editor can still become the default for this project's initial brief.
      await onCreate({ mode: 'ai', kind, name: '', prompt: prompt.trim(), attachments, generateImages: imageChoice });
    } catch (cause) { setError(cause.message); }
    finally { submitting.current = false; setSending(false); }
  }

  function chooseIdea(value) {
    setPrompt(kind === 'template' ? `${value} Make it a reusable template with editable content and images.` : value);
    requestAnimationFrame(() => root.current?.querySelector('textarea')?.focus());
  }

  return <div className="home-project-chat" ref={root}>
    <div className="home-chat-intro">
      <span className="home-chat-kicker"><Sparkles size={15} aria-hidden="true" />YOUR IDEAS, WITH AI</span>
      <h2 id="library-title">Ideas become pages.</h2>
      <p>Describe what you have in mind. Build it together.</p>
    </div>
    <div className="home-chat-kind" role="group" aria-label="Create with AI project type">
      {[["landing", "Landing page", FileCode2], ["template", "Reusable template", LayoutTemplate]].map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={kind === value} disabled={disabled} onClick={() => setKind(value)}><Icon size={15} aria-hidden="true" />{label}</button>)}
    </div>
    <ConversationComposer prompt={prompt} onPromptChange={setPrompt} attachments={attachments} onAttachmentsChange={setAttachments}
      onBusyChange={setReadingAttachments} disabled={disabled} onSubmit={submit} submitLabel={sending || busy ? 'Creating…' : 'Create project'}
      placeholder={kind === 'template' ? 'Describe a reusable template…' : 'Describe your landing page…'} settings={settings}
      generateImages={resolveImageGeneration(imageChoice, settings)} onGenerateImagesChange={setImageChoice} />
    {error && <p className="inline-error home-chat-error" role="alert">{error}</p>}
    <div className="home-chat-ideas" role="group" aria-label="Ideas to get started"><span>Try an idea</span>{ideas.map(([label, value]) => <button type="button" key={label} disabled={disabled || Boolean(prompt.trim())} onClick={() => chooseIdea(value)}>{label}</button>)}</div>
    <p className="home-chat-note">Send your brief to open a new project and continue the conversation.</p>
  </div>;
}
