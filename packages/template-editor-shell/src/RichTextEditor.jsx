import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { renderRichText } from '@trafficops/template-runtime';
import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Code, Link, Unlink, ImagePlus, Undo2, Redo2, Minus } from 'lucide-react';
import { imageMime } from './image-editing.js';
import { prepareWysiwygValue, isEditorImageSource } from './rich-text-value.js';
import { useStudioText } from './studio-i18n.js';

const Figure = Node.create({ name: 'figure', group: 'block', content: 'image figcaption?', draggable: true,
  parseHTML: () => [{ tag: 'figure' }], renderHTML: () => ['figure', 0] });
const Caption = Node.create({ name: 'figcaption', content: 'inline*',
  parseHTML: () => [{ tag: 'figcaption' }], renderHTML: () => ['figcaption', 0] });
const safeLink = value => value && !/[\\\x00-\x20\x7f]/.test(value) && !value.startsWith('//') && (!/^[a-z][\w+.-]*:/i.test(value) || /^(?:https?:\/\/|mailto:)/i.test(value));

export default function RichTextEditor({ id, field, value, onChange, projectImages = [], onImageUpload, files = {}, describedBy, invalid, disabled = false }) {
  const t = useStudioText(), markdown = field.type === 'markdown';
  const [sourceMode, setSourceMode] = useState(false), [tool, setTool] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [url, setUrl] = useState(''), [alt, setAlt] = useState(''), [caption, setCaption] = useState('');
  const callback = useRef(onChange), currentFiles = useRef(files), lastValue = useRef(String(value ?? '')), urls = useRef(new Map()), imageViews = useRef(new Set()), selection = useRef(null);
  callback.current = onChange; currentFiles.current = files;
  function resolveImage(source) {
    if (Object.hasOwn(currentFiles.current, source)) {
      const bytes = currentFiles.current[source], cached = urls.current.get(source);
      if (cached?.bytes === bytes) return cached.url;
      if (cached) URL.revokeObjectURL(cached.url);
      const url = URL.createObjectURL(new Blob([bytes], { type: imageMime(source) }));
      urls.current.set(source, { bytes, url }); return url;
    }
    return /^https?:\/\//i.test(source || '') ? source : 'data:,';
  }
  const extensions = useMemo(() => {
    const ProjectImage = Image.extend({
      renderMarkdown(node) {
        const alt = String(node.attrs?.alt || '').replace(/[\\[\]]/g, '\\$&');
        const source = String(node.attrs?.src || '');
        const destination = /[\s()<>]/.test(source) ? `<${source.replace(/</g, '%3C').replace(/>/g, '%3E')}>` : source;
        const title = node.attrs?.title ? ` "${String(node.attrs.title).replace(/[\\"]/g, '\\$&')}"` : '';
        return `![${alt}](${destination}${title})`;
      },
      addNodeView() {
        return ({ node }) => {
          const dom = document.createElement('img'); let current = node;
          const view = { refresh() { dom.src = resolveImage(current.attrs.src); dom.alt = current.attrs.alt || ''; dom.title = current.attrs.title || ''; } };
          view.refresh(); imageViews.current.add(view);
          return { dom, update(next) { if (next.type !== current.type) return false; current = next; view.refresh(); return true; }, destroy() { imageViews.current.delete(view); } };
        };
      },
    });
    return [StarterKit.configure({ underline: markdown ? false : {}, strike: markdown ? false : {},
      link: { openOnClick: false, autolink: false, HTMLAttributes: { target: null, rel: null } } }), ProjectImage,
    ...(markdown ? [Markdown.configure({ markedOptions: { gfm: false, breaks: false } })] : [Figure, Caption])];
  }, [markdown]);
  const editor = useEditor({
    extensions, content: renderRichText(field.type, markdown ? String(value ?? '') : prepareWysiwygValue(value)),
    immediatelyRender: true, shouldRerenderOnTransaction: false, editable: !disabled,
    editorProps: { attributes: { id, role: 'textbox', 'aria-label': field.label || field.name, 'aria-multiline': 'true', 'aria-required': String(Boolean(field.required)), 'aria-describedby': describedBy || '', 'aria-invalid': String(Boolean(invalid)) } },
    onUpdate({ editor }) {
      const next = editor.isEmpty ? '' : markdown ? editor.getMarkdown() : editor.getHTML();
      lastValue.current = next; callback.current(next);
    },
  }, [id, markdown]);
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'), strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'), orderedList: editor.isActive('orderedList'), blockquote: editor.isActive('blockquote'), code: editor.isActive('code'), link: editor.isActive('link'),
    heading: [1, 2, 3, 4, 5, 6].find(level => editor.isActive('heading', { level })) || 0,
    undo: editor.can().undo(), redo: editor.can().redo(),
  } : {} });

  useEffect(() => {
    if (!editor) return;
    const raw = String(value ?? ''), prepared = markdown ? raw : prepareWysiwygValue(raw);
    if (raw !== lastValue.current) {
      lastValue.current = raw;
      editor.commands.setContent(renderRichText(field.type, prepared), { emitUpdate: false });
    }
    // Opening authored content never serializes it through the editor's schema.
    // ParameterForm repairs legacy values together to avoid sibling update races.
  }, [editor, value, markdown, field.type]);
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => { editor?.setOptions({ editorProps: { attributes: { id, role: 'textbox', 'aria-label': field.label || field.name, 'aria-multiline': 'true', 'aria-required': String(Boolean(field.required)), 'aria-describedby': describedBy || '', 'aria-invalid': String(Boolean(invalid)) } } }); }, [editor, id, field.label, field.name, field.required, describedBy, invalid]);
  useEffect(() => { for (const view of imageViews.current) view.refresh(); }, [files]);
  useEffect(() => () => { for (const entry of urls.current.values()) URL.revokeObjectURL(entry.url); urls.current.clear(); }, []);

  function openTool(name) {
    selection.current = editor.state.selection;
    setError(''); setTool(name); setUrl(name === 'link' ? editor.getAttributes('link').href || '' : editor.getAttributes('image').src || projectImages[0] || '');
    setAlt(editor.getAttributes('image').alt || ''); setCaption('');
  }
  function insertImage(source) {
    const chain = editor.chain().focus().setTextSelection({ from: selection.current.from, to: selection.current.to });
    const attrs = { src: source, alt };
    if (editor.isActive('image')) chain.updateAttributes('image', attrs).run();
    else if (markdown) chain.setImage(attrs).run();
    else chain.insertContent({ type: 'figure', content: [{ type: 'image', attrs }, ...(caption ? [{ type: 'figcaption', content: [{ type: 'text', text: caption }] }] : [])] }).run();
    setTool(null);
  }
  async function upload(file) {
    if (!file || busy || !onImageUpload) return;
    setBusy(true); setError('');
    try { const path = await onImageUpload(file); if (!path) throw new Error(t('The image could not be saved. Check project access and size.')); if (!editor.isDestroyed) insertImage(path); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  function submit(event) {
    event.preventDefault(); const source = url.trim();
    if (tool === 'image') {
      if (!isEditorImageSource(source, projectImages)) { setError(t('Choose a project image or enter an HTTP(S) image URL.')); return; }
      insertImage(source);
    } else {
      if (source && !safeLink(source)) { setError(t('Enter a safe link URL.')); return; }
      const chain = editor.chain().focus().setTextSelection({ from: selection.current.from, to: selection.current.to }).extendMarkRange('link');
      (source ? chain.setLink({ href: source }) : chain.unsetLink()).run(); setTool(null);
    }
  }
  const preview = useMemo(() => {
    if (!markdown || !sourceMode) return '';
    const document = new DOMParser().parseFromString(renderRichText('markdown', String(value ?? '')), 'text/html');
    document.querySelectorAll('img').forEach(image => { image.src = resolveImage(image.getAttribute('src')); });
    return document.body.innerHTML;
  }, [markdown, sourceMode, value, files]);
  if (!editor) return <p className="field-help">{t('Loading editor…')}</p>;
  const button = (label, Icon, action, active, unavailable = false) => <button type="button" title={label} aria-label={label} aria-pressed={active === undefined ? undefined : Boolean(active)} disabled={disabled || unavailable || sourceMode} onMouseDown={event => event.preventDefault()} onClick={action}><Icon size={16} /></button>;
  return <div className="rich-editor" data-format={field.type}>
    {markdown && <div className="rich-editor-modes" role="group" aria-label={t('Editing mode')}><button type="button" aria-pressed={!sourceMode} onClick={() => { setSourceMode(false); setTool(null); }}>{t('Visual editor')}</button><button type="button" aria-pressed={sourceMode} onClick={() => { setSourceMode(true); setTool(null); }}>{t('Markdown source')}</button></div>}
    {!sourceMode && <div className="rich-editor-toolbar" role="toolbar" aria-label={t('Text formatting')}>
      <select aria-label={t('Paragraph style')} value={state?.heading || 0} onChange={event => { const level = Number(event.target.value); const chain = editor.chain().focus(); (level ? chain.setHeading({ level }) : chain.setParagraph()).run(); }}><option value="0">{t('Paragraph')}</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>{t('Heading {number}', { number: level })}</option>)}</select>
      {button(t('Bold'), Bold, () => editor.chain().focus().toggleBold().run(), state?.bold)}
      {button(t('Italic'), Italic, () => editor.chain().focus().toggleItalic().run(), state?.italic)}
      {!markdown && button(t('Underline'), Underline, () => editor.chain().focus().toggleUnderline().run(), state?.underline)}
      {!markdown && button(t('Strikethrough'), Strikethrough, () => editor.chain().focus().toggleStrike().run(), state?.strike)}
      {button(t('Bullet list'), List, () => editor.chain().focus().toggleBulletList().run(), state?.bulletList)}
      {button(t('Numbered list'), ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), state?.orderedList)}
      {button(t('Block quote'), Quote, () => editor.chain().focus().toggleBlockquote().run(), state?.blockquote)}
      {button(t('Inline code'), Code, () => editor.chain().focus().toggleCode().run(), state?.code)}
      {button(t('Insert link'), Link, () => openTool('link'), state?.link)}
      {state?.link && button(t('Remove link'), Unlink, () => editor.chain().focus().unsetLink().run())}
      {button(t('Insert image'), ImagePlus, () => openTool('image'))}
      {button(t('Horizontal rule'), Minus, () => editor.chain().focus().setHorizontalRule().run())}
      {button(t('Undo'), Undo2, () => editor.chain().focus().undo().run(), undefined, !state?.undo)}
      {button(t('Redo'), Redo2, () => editor.chain().focus().redo().run(), undefined, !state?.redo)}
    </div>}
    {tool && <form className="rich-editor-insert" onSubmit={submit} aria-label={tool === 'image' ? t('Insert image') : t('Insert link')}>
      <label>{tool === 'image' ? t('Image source') : t('Link URL')}<input className="input w-full" value={url} list={tool === 'image' ? `${id}-image-options` : undefined} onChange={event => setUrl(event.target.value)} autoFocus /></label>
      {tool === 'image' && <><datalist id={`${id}-image-options`}>{projectImages.map(path => <option key={path} value={path} />)}</datalist><label>{t('Alternative text')}<input className="input w-full" value={alt} onChange={event => setAlt(event.target.value)} /></label>{!markdown && <label>{t('Image caption')}<input className="input w-full" value={caption} onChange={event => setCaption(event.target.value)} /></label>}{onImageUpload && <label className="btn btn-outline btn-sm">{t('Upload image')}<input type="file" hidden accept="image/*,.svg" disabled={busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label>}</>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="rich-editor-insert-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t('Apply')}</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setTool(null)}>{t('Cancel')}</button></div>
    </form>}
    <div hidden={sourceMode}><EditorContent editor={editor} /></div>
    {sourceMode && <div className="rich-editor-source"><textarea id={`${id}-source`} aria-label={t('Markdown source')} aria-describedby={describedBy} aria-invalid={invalid || undefined} className="textarea w-full" rows={8} value={String(value ?? '')} onChange={event => { const next = event.target.value; lastValue.current = next; editor.commands.setContent(renderRichText('markdown', next), { emitUpdate: false }); callback.current(next); }} /><div className="rich-editor-preview" role="region" aria-label={t('Markdown preview')} onClick={event => { if (event.target.closest('a')) event.preventDefault(); }} dangerouslySetInnerHTML={{ __html: preview }} /></div>}
  </div>;
}
