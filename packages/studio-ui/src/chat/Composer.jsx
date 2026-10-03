import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, AtSign, Image as ImageIcon, Paperclip } from 'lucide-react';
import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useStudioText } from '../i18n/StudioUiProvider.jsx';
import Button from '../primitives/Button.jsx';
import MentionMenu, { MentionEmpty, MentionOptions, optionId } from './MentionMenu.jsx';
import InlineNotice from '../primitives/InlineNotice.jsx';
import Attachments, { AttachmentCounter, RejectedAttachments } from './Attachments.jsx';
import ScopeChips from './ScopeChips.jsx';
import { addMention, groupTargets, inlineMentionTarget, insertMention, mentionAtCaret, mentionKey, mentionSegments, mentionsInText } from './mentions.js';
import { appendAttachments, filesFromClipboard, filesFromDrop } from './attachments.js';

// StudioChat renders the composer under AssistantRuntimeProvider and sets this context to { onSubmit(text), clarifyWhileRunning }.
// assistant-ui 0.15 has no optional runtime hook (useAssistantRuntime({ optional }) / useThreadRuntime are gone),
// so the runtime mode is signalled by this context; without it the composer is a plain <form> (home screens).
export const ChatComposerContext = createContext(null);

// A controlled pair when value !== undefined, otherwise internal state seeded with initial.
function useControllable(value, onChange, initial) {
  const [inner, setInner] = useState(initial);
  const controlled = value !== undefined;
  const set = useCallback(next => { if (!controlled) setInner(next); onChange?.(next); }, [controlled, onChange]);
  return [controlled ? value : inner, set, controlled];
}

const defaultScopeKind = scopes => (scopes.includes('project') || !scopes.length ? 'project' : scopes[0]);

// Props:
// port?: ChatPort — default source of mentionTargets, attachmentLimits and capabilities (generateImages, scopes);
// mentionTargets?(query, kind), attachmentLimits?, scopes? — override the port; without port and these props the mention
//   menu and the limits are off and the image toggle is hidden (Landing HomeProjectChat, Media home);
// value/onChange(text) — controlled text (Landing: the draft lives in EditorShell); initialText — uncontrolled (Media);
// scope/onScopeChange, mentions/onMentionsChange, attachments (File[])/onAttachmentsChange, generateImages/onGenerateImagesChange —
//   controlled pairs (internal state when the value is not passed); under StudioChat they must be controlled, the runtime
//   reads them from StudioChat state;
// onSubmit({ text, attachments, mentions, scope, generateImages }) — standalone mode only; returning false keeps the input;
// disabled?, placeholder? (product text, shown as is; the built-in default is translated), extra?: ReactNode (product controls in the toolbar), autoFocus?.
export default function StudioComposer(props) {
  const chat = useContext(ChatComposerContext);
  return chat ? <RuntimeComposer {...props} chat={chat} /> : <StandaloneComposer {...props} />;
}

function useComposerParts({ port, mentionTargets, attachmentLimits, scopes, scope, onScopeChange, mentions, onMentionsChange, attachments, onAttachmentsChange, generateImages, onGenerateImagesChange }) {
  const scopeKinds = scopes ?? port?.capabilities?.scopes ?? [];
  const [scopeValue, setScope, scopeControlled] = useControllable(scope, onScopeChange, { kind: defaultScopeKind(scopeKinds) });
  const [mentionList, setMentions, mentionsControlled] = useControllable(mentions, onMentionsChange, []);
  const [files, setFiles, filesControlled] = useControllable(attachments, onAttachmentsChange, []);
  const [images, setImages] = useControllable(generateImages, onGenerateImagesChange, true);
  const targets = mentionTargets ?? (typeof port?.mentionTargets === 'function' ? (query, kind) => port.mentionTargets(query, kind) : null);
  const limits = attachmentLimits ?? port?.attachmentLimits;
  return {
    scopeKinds, scope: scopeValue, setScope, mentions: mentionList, setMentions, files, setFiles, images, setImages,
    targets, limits, attachEnabled: Boolean(limits || onAttachmentsChange), showImages: Boolean(port?.capabilities?.generateImages),
    reset() {
      if (!mentionsControlled) setMentions([]);
      if (!filesControlled) setFiles([]);
      if (!scopeControlled) setScope({ kind: defaultScopeKind(scopeKinds) });
    },
  };
}

function StandaloneComposer(props) {
  const [text, setText, textControlled] = useControllable(props.value, props.onChange, props.initialText ?? '');
  const parts = useComposerParts(props);
  // onSubmit may be async: a second submit is blocked until it settles; a rejection keeps the input and shows a notice.
  const [pending, setPending] = useState(false), [error, setError] = useState(null), inFlight = useRef(false);
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    let result;
    try {
      result = await props.onSubmit?.({ text, attachments: parts.files, mentions: mentionsInText(text, parts.mentions), scope: parts.scope, generateImages: parts.images && parts.showImages });
    } catch (failure) {
      setError(failure ?? new Error());
      return;
    } finally { inFlight.current = false; setPending(false); }
    if (result === false) return;
    if (!textControlled) setText('');
    parts.reset();
  }
  return <ComposerBody {...props} parts={parts} text={text} setText={setText} onInputText={setText} submit={submit} runtime={false} busy={pending}
    error={error} onDismissError={() => setError(null)} />;
}

function RuntimeComposer({ chat, ...props }) {
  const aui = useAui();
  const text = useAuiState(state => state.composer.text);
  const running = useAuiState(state => state.thread.isRunning) && !chat.clarifyWhileRunning;
  const parts = useComposerParts(props);
  // Text sync with the assistant-ui composer: initialText seeds it once, a controlled value is pushed when the prop changes,
  // and composer changes (typing, cleared after send) are reported through onChange. A push is not reported back until
  // the composer reflects it (the store may lag a render behind setText).
  const onChange = props.onChange;
  const pending = useRef(null), reported = useRef(text), lastValue = useRef(props.value);
  const push = useCallback(next => { if (next === aui.composer.getState().text) return; pending.current = next; aui.composer.setText(next); }, [aui]);
  const setText = useCallback(next => { push(next); reported.current = next; lastValue.current = next; onChange?.(next); }, [push, onChange]);
  const seed = props.value ?? props.initialText;
  useEffect(() => { if (seed) push(seed); }, [push]); // seed once per composer (push is stable)
  useEffect(() => {
    if (props.value === undefined || props.value === lastValue.current) return;
    lastValue.current = props.value;
    if (props.value !== reported.current) push(props.value);
  }, [props.value, push]);
  useEffect(() => {
    if (pending.current !== null) { if (text !== pending.current) return; pending.current = null; reported.current = text; return; }
    if (text === reported.current) return;
    reported.current = text; lastValue.current = text;
    onChange?.(text);
  }, [text, onChange]);
  // StudioChat sends (text or attachments only) and owns clearing and restoring; composer.send() is not used, so a
  // rejected send can give the input back and a clarification during a run is not tied to assistant-ui's send rules.
  // The composer clears itself as well: when typing and Enter land in one React batch, StudioChat's text never held the
  // typed value, so its clear() does not change the value prop and would not reach the assistant-ui composer.
  function submit() { chat.onSubmit(text); setText(''); }
  return <ComposerBody {...props} parts={parts} text={text} setText={setText} submit={submit} runtime busy={running} />;
}

const DEFAULT_PLACEHOLDER = 'What would you like to create or change?';

function ComposerBody({ parts, text, setText, onInputText, submit, runtime, busy = false, error, onDismissError, disabled = false, placeholder, extra, autoFocus = false }) {
  const t = useStudioText(), id = useId(), listId = `${id}-mentions`;
  const root = useRef(null), input = useRef(null), fileInput = useRef(null), highlights = useRef(null);
  const [query, setQuery] = useState(null), [active, setActive] = useState(0), [rejected, setRejected] = useState([]);
  const trackedQuery = useRef(null);
  const { mentions, files, targets, limits } = parts;
  // Keep picked targets through native undo/redo, even after their text has been deleted.
  // Only references still present in the message are sent; sending starts a fresh registry.
  const picked = useRef(new Map());
  for (const target of mentions) picked.current.set(mentionKey(target), target);
  const mentionsEnabled = Boolean(targets) && !disabled;
  const groups = useMemo(() => {
    if (!query || !mentionsEnabled) return [];
    return groupTargets(targets(query.query) ?? []);
  }, [query, mentionsEnabled, targets, mentions]);
  const options = groups.flatMap(group => group.items);
  const menuOpen = Boolean(query) && mentionsEnabled, listOpen = menuOpen && options.length > 0;
  const canSubmit = !disabled && !busy && (text.trim().length > 0 || files.length > 0);

  const pendingCaret = useRef(null);
  // Restore selection as soon as the new value reaches the DOM, before the user can type again.
  // A deferred animation frame could move the caret backwards after the first characters were already entered.
  useLayoutEffect(() => {
    const next = pendingCaret.current;
    if (!next || text !== next.text) return;
    pendingCaret.current = null; input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret);
  }, [text]);
  const focusAt = (caret, value) => { pendingCaret.current = { caret, text: value }; };
  const trackQuery = (value, caret) => {
    const previous = trackedQuery.current;
    const raw = mentionsEnabled ? mentionAtCaret(value, caret ?? value.length) : null;
    // A new query may spell a target already used earlier in the draft. Keep its picker open until selection.
    const next = raw && previous?.start === raw.start ? raw : mentionsEnabled ? mentionAtCaret(value, caret ?? value.length, [...picked.current.values()]) : null;
    if (previous?.start !== next?.start || previous?.end !== next?.end || previous?.query !== next?.query) setActive(0);
    trackedQuery.current = next; setQuery(next);
  };
  function select(target) {
    if (!target) return;
    target = inlineMentionTarget(target, targets(target.label));
    picked.current.set(mentionKey(target), target);
    parts.setMentions(addMention(mentions, target));
    const next = insertMention(text, query, target);
    focusAt(next.caret, next.text); trackedQuery.current = null; setText(next.text); setQuery(null);
  }
  function openMenu() {
    const caret = input.current?.selectionStart ?? text.length;
    const insert = caret > 0 && !/\s/.test(text[caret - 1]) ? ' @' : '@';
    const position = caret + insert.length;
    const value = text.slice(0, caret) + insert + text.slice(caret);
    focusAt(position, value); setText(value);
    trackedQuery.current = { start: position - 1, end: position, query: '' };
    setQuery(trackedQuery.current); setActive(0);
  }
  function addFiles(incoming) {
    if (!incoming.length || !parts.attachEnabled || disabled) return;
    const result = appendAttachments(files, incoming, limits);
    setRejected(result.rejected);
    if (result.accepted.length) parts.setFiles([...files, ...result.accepted]);
  }
  function keyDown(event) {
    // IME: Enter confirms the composition, it neither picks a mention nor sends.
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (menuOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) && !(event.key === 'Enter' && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { trackedQuery.current = null; setQuery(null); }
      else if (event.key === 'Enter') { if (options[active]) select(options[active]); else setQuery(null); }
      else if (event.key === 'ArrowDown') setActive(value => (options.length ? (value + 1) % options.length : 0));
      else if (event.key === 'ArrowUp') setActive(value => (options.length ? (value + options.length - 1) % options.length : 0));
      return;
    }
    // Enter sends, Shift+Enter is a new line; both modes go through the form submit.
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); root.current?.requestSubmit(); }
  }
  function onFormSubmit(event) {
    // In runtime mode preventDefault also skips ComposerPrimitive.Root's own send (it is disabled for empty text).
    event.preventDefault();
    if (!canSubmit) return;
    trackedQuery.current = null; setQuery(null); setRejected([]);
    picked.current.clear();
    submit();
  }

  const Root = runtime ? ComposerPrimitive.Root : 'form';
  const Input = runtime ? ComposerPrimitive.Input : 'textarea';
  const runtimeInputProps = runtime ? { cancelOnEscape: !menuOpen, addAttachmentOnPaste: false, submitMode: 'none', maxRows: 10 } : { rows: 3, value: text };
  return <Root ref={root} data-testid="studio-chat-composer" className="studio-chat-composer" aria-disabled={disabled || undefined} aria-busy={busy || undefined}
    onSubmit={onFormSubmit}
    onPaste={event => { const pasted = filesFromClipboard(event); if (pasted.length && parts.attachEnabled) { event.preventDefault(); addFiles(pasted); } }}
    onDragOver={event => { if (parts.attachEnabled && Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault(); }}
    onDrop={event => { const dropped = filesFromDrop(event); if (dropped.length && parts.attachEnabled) { event.preventDefault(); addFiles(dropped); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setQuery(null); }}>
    <RejectedAttachments rejected={rejected} limits={limits} onDismiss={() => setRejected([])} />
    {error && <InlineNotice tone="danger" title={t('The message was not sent')} actions={<Button variant="ghost" size="sm" onClick={onDismissError}>{t('Dismiss')}</Button>}>{error.message || t('Something went wrong.')}</InlineNotice>}
    <Attachments files={files} disabled={disabled} onRemove={index => parts.setFiles(files.filter((_, position) => position !== index))} />
    <div className="studio-chat-composer-field">
      {menuOpen && <MentionMenu anchor={root} active={active}>{list => listOpen ? <div ref={list} id={listId} role="listbox" aria-label={t('Mention targets')} className="studio-mention-menu-list">
        <MentionOptions id={listId} groups={groups} active={active} onSelect={select} onHover={setActive} />
      </div> : <MentionEmpty />}</MentionMenu>}
      <label className="studio-sr-only" htmlFor={`${id}-input`}>{t('Message to assistant')}</label>
      <div ref={highlights} className="studio-chat-composer-highlights" aria-hidden="true">{mentionSegments(text, mentions).map(part => part.target ? <mark key={part.start}>{part.text}</mark> : part.text)}{'\n'}</div>
      <Input {...runtimeInputProps} id={`${id}-input`} ref={input} className="studio-chat-composer-input" placeholder={placeholder ?? t(DEFAULT_PLACEHOLDER)} disabled={disabled} autoFocus={autoFocus}
        role={mentionsEnabled ? 'combobox' : undefined} aria-autocomplete={mentionsEnabled ? 'list' : undefined} aria-expanded={mentionsEnabled ? listOpen : undefined}
        aria-controls={listOpen ? listId : undefined} aria-activedescendant={listOpen && options[active] ? optionId(listId, active) : undefined}
        onKeyDown={keyDown}
        onChange={event => { onInputText?.(event.target.value); parts.setMentions(mentionsInText(event.target.value, [...picked.current.values()])); trackQuery(event.target.value, event.target.selectionStart); }}
        onScroll={event => { if (highlights.current) { highlights.current.scrollTop = event.currentTarget.scrollTop; highlights.current.scrollLeft = event.currentTarget.scrollLeft; } }}
        onSelect={event => { if (event.target.selectionStart === event.target.selectionEnd) trackQuery(event.target.value, event.target.selectionStart); }} />
    </div>
    <div className="studio-chat-composer-toolbar">
      <ScopeChips scopes={parts.scopeKinds} scope={parts.scope} onScopeChange={parts.setScope} disabled={disabled} />
      {parts.attachEnabled && <>
        <Button variant="ghost" size="sm" icon={Paperclip} disabled={disabled} aria-label={t('Attach files')} title={t('Attach files')} onClick={() => fileInput.current?.click()} />
        <input ref={fileInput} type="file" multiple hidden accept={limits?.accept} tabIndex={-1} aria-hidden="true"
          onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      </>}
      {mentionsEnabled && <Button variant="ghost" size="sm" icon={AtSign} aria-label={t('Mention')} title={t('Mention')} onClick={openMenu} />}
      {/* the budget appears once a file is attached; the attach button is always there */}
      {files.length > 0 && <AttachmentCounter files={files} limits={limits} />}
      {parts.showImages && <Button variant="ghost" size="sm" icon={ImageIcon} disabled={disabled} aria-pressed={parts.images} className="studio-chat-composer-images" onClick={() => parts.setImages(!parts.images)}>{t('Generate images')}</Button>}
      {extra && <span className="studio-chat-composer-extra">{extra}</span>}
      <Button variant="primary" size="sm" type="submit" icon={ArrowUp} disabled={!canSubmit} aria-label={t('Send message')} title={t('Send message')} className="studio-chat-composer-send" />
    </div>
  </Root>;
}
