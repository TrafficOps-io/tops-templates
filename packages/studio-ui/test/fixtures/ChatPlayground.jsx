import { useEffect, useState } from 'react';
import { StudioUiProvider } from '../../src/i18n/StudioUiProvider.jsx';
import { StudioChat } from '../../src/chat/index.js';
import { createFakeChatPort } from './FakeChatPort.js';

// StudioChat on FakeChatPort for test/chat-browser.mjs. Deliberately without ToastProvider: StudioChat must not need it.
// Test handles: window.fake (the port), window.threadId / window.setThreadId, window.setTheme(name), window.launch(launch),
// window.actionCalls — texts passed to the header action.
const port = createFakeChatPort();
window.fake = port;
window.actionCalls = [];
const actions = [{ id: 'recreate', label: 'Create the project anew', onSelect: ({ text }) => window.actionCalls.push(text) }];

export default function ChatPlayground() {
  const [threadId, setThreadId] = useState(''), [theme, setTheme] = useState('studio-dark'), [launch, setLaunch] = useState(null);
  useEffect(() => { window.threadId = threadId; }, [threadId]);
  useEffect(() => { window.setThreadId = setThreadId; window.setTheme = setTheme; window.launch = setLaunch; }, []);
  return <div className="studio-root" data-theme={theme} style={{ height: '100vh' }}>
    <StudioUiProvider language="en">
      <StudioChat port={port} threadId={threadId} onThreadChange={setThreadId} launch={launch} actions={actions} />
    </StudioUiProvider>
  </div>;
}
