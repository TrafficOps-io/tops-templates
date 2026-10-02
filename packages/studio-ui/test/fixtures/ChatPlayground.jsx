import { useEffect, useState } from 'react';
import { StudioUiProvider } from '../../src/i18n/StudioUiProvider.jsx';
import { StudioChat, StudioComposer } from '../../src/chat/index.js';
import { ModelPicker } from '../../src/primitives/index.js';
import { createFakeChatPort } from './FakeChatPort.js';

// StudioChat on FakeChatPort for test/chat-browser.mjs. Deliberately without ToastProvider: StudioChat must not need it.
// Test handles: window.fake (the port), window.threadId / window.setThreadId, window.setTheme(name), window.launch(launch),
// window.actionCalls — texts passed to the header action, window.pickerChanges — values passed to onChange of the ModelPicker demo, window.scopes — scopes reported by onScopeChange, window.standaloneSubmit — onSubmit of the standalone composer.
// ?clarify=1 turns on capabilities.clarifyWhileRunning, ?discardStopped=1 — capabilities.discardStopped; ?scopes=project,file overrides capabilities.scopes;
// ?noBranching=1 removes regenerate, editMessage and switchBranch from the port; ?portal=1 renders the ModelPicker demo popover into #picker-layer.
const port = createFakeChatPort();
const query = new URLSearchParams(location.search);
if (query.has('clarify')) port.capabilities = { ...port.capabilities, clarifyWhileRunning: true };
if (query.has('discardStopped')) port.capabilities = { ...port.capabilities, discardStopped: true };
if (query.has('noBranching')) { delete port.regenerate; delete port.editMessage; delete port.switchBranch; }
if (query.get('scopes')) port.capabilities = { ...port.capabilities, scopes: query.get('scopes').split(',') };
window.fake = port;
window.actionCalls = [];
window.scopes = [];
const actions = [{ id: 'recreate', label: 'Create the project anew', onSelect: ({ text }) => window.actionCalls.push(text) }];
window.pickerChanges = [];

// 400+ models for ModelPicker: a few realistic ones, then 400 generated across eight developers.
const DEVELOPERS = ['openai', 'anthropic', 'google', 'meta-llama', 'mistralai', 'x-ai', 'deepseek', 'qwen'];
const MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextLength: 1048576, price: { input: '$0.30', output: '$2.50', unit: '/ 1M' }, badges: ['tools', 'vision', 'audio', 'reasoning'] },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', contextLength: 128000, price: { input: '$0.15', output: '$0.60', unit: '/ 1M' }, badges: ['tools', 'vision'] },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)', contextLength: 131072, badges: ['tools', 'free'] },
  { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B Instruct', contextLength: 32768, price: { input: '$0.03', output: '$0.05', unit: '/ 1M' }, badges: [], disabledReason: 'Does not support tools — the agent cannot change the project' },
  ...Array.from({ length: 400 }, (_, index) => {
    const developer = DEVELOPERS[index % DEVELOPERS.length], free = index % 11 === 0;
    return {
      id: `${developer}/model-${index}`, name: `${developer.split('-')[0].replace(/^./, letter => letter.toUpperCase())} Model ${index}`, contextLength: 8192 * (1 + (index % 64)),
      price: free ? undefined : { input: `$${(index % 9 + 1) / 10}`, output: `$${(index % 9 + 1) / 5}`, unit: '/ 1M' },
      badges: [index % 2 === 0 && 'tools', index % 3 === 0 && 'vision', index % 7 === 0 && 'audio', index % 5 === 0 && 'reasoning', free && 'free'].filter(Boolean),
    };
  }),
];
window.models = MODELS;

function PickerDemo() {
  const [value, setValue] = useState(null), [layer, setLayer] = useState(null);
  return <div id="model-picker-demo" style={{ padding: '1rem' }}>
    <div id="picker-layer" ref={setLayer} />
    <ModelPicker label="Assistant model" value={value} portalContainer={query.has('portal') ? layer ?? undefined : undefined} onChange={next => { window.pickerChanges.push(next); setValue(next); }} options={MODELS}
      recentIds={['openai/gpt-4o-mini', 'google/gemini-2.5-flash']} recommendedIds={['google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct:free']}
      inherit={{ label: 'As in global settings', detail: 'Gemini 2.5 Flash' }} />
  </div>;
}

export default function ChatPlayground() {
  const [threadId, setThreadId] = useState(''), [theme, setTheme] = useState('studio-dark'), [launch, setLaunch] = useState(null), [model, setModel] = useState('openai/gpt-4o-mini');
  useEffect(() => { window.threadId = threadId; }, [threadId]);
  useEffect(() => { window.setThreadId = setThreadId; window.setTheme = setTheme; window.launch = setLaunch; }, []);
  return <div className="studio-root" data-theme={theme}>
    <StudioUiProvider language="en">
      <div style={{ height: '100vh' }}><StudioChat port={port} threadId={threadId} onThreadChange={setThreadId} onScopeChange={scope => window.scopes.push(scope)} launch={launch} actions={actions} composerExtra={<ModelPicker compact label="Assistant model" value={model} onChange={setModel} options={MODELS} />} /></div>
      <div id="standalone"><StudioComposer onSubmit={input => window.standaloneSubmit?.(input)} /></div>
      <PickerDemo />
    </StudioUiProvider>
  </div>;
}
