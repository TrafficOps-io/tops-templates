import { useEffect, useState } from 'react';
import { StudioUiProvider } from '../../src/i18n/StudioUiProvider.jsx';
import { StudioChat, StudioComposer } from '../../src/chat/index.js';
import { createFakeChatPort } from './FakeChatPort.js';

// StudioChat on FakeChatPort for test/chat-browser.mjs. Deliberately without ToastProvider: StudioChat must not need it.
// Test handles: window.fake (the port), window.threadId / window.setThreadId, window.setTheme(name), window.launch(launch),
// window.actionCalls — texts passed to the header action, window.scopes — scopes reported by onScopeChange, window.standaloneSubmit — onSubmit of the standalone composer.
// ?clarify=1 turns on capabilities.clarifyWhileRunning, ?discardStopped=1 — capabilities.discardStopped; ?scopes=project,file overrides capabilities.scopes;
// ?noBranching=1 removes regenerate, editMessage and switchBranch from the port.
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

export default function ChatPlayground() {
  const [threadId, setThreadId] = useState(''), [theme, setTheme] = useState('studio-dark'), [launch, setLaunch] = useState(null);
  useEffect(() => { window.threadId = threadId; }, [threadId]);
  useEffect(() => { window.setThreadId = setThreadId; window.setTheme = setTheme; window.launch = setLaunch; }, []);
  return <div className="studio-root" data-theme={theme}>
    <StudioUiProvider language="en">
      <div style={{ height: '100vh' }}><StudioChat port={port} threadId={threadId} onThreadChange={setThreadId} onScopeChange={scope => window.scopes.push(scope)} launch={launch} actions={actions} /></div>
      <div id="standalone"><StudioComposer onSubmit={input => window.standaloneSubmit?.(input)} /></div>
    </StudioUiProvider>
  </div>;
}
