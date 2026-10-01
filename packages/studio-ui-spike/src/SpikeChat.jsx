import { useState } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { Streamdown } from 'streamdown';
import './spike.css';

const seed = Array.from({ length: 20 }, (_, index) => ({
  id: `m${index}`, role: index % 2 ? 'assistant' : 'user',
  content: [{ type: 'text', text: index % 2 ? `**Ответ ${index}** с *markdown*\n\n- пункт\n- ещё пункт\n\n\`код\`` : `Сообщение ${index} с @mention` }],
}));

function Text({ text }) { return <Streamdown>{text}</Streamdown>; }
// MessagePrimitive.Root не выставляет data-role сам (проверено по dist 0.15.22) — роль ставим руками
// через раздельные компоненты UserMessage / AssistantMessage, которые принимает ThreadPrimitive.Messages.
function UserMessage() {
  return <MessagePrimitive.Root className="spike-message" data-role="user"><MessagePrimitive.Parts components={{ Text }} /></MessagePrimitive.Root>;
}
function AssistantMessage() {
  return <MessagePrimitive.Root className="spike-message" data-role="assistant"><MessagePrimitive.Parts components={{ Text }} /></MessagePrimitive.Root>;
}

export default function SpikeChat({ onEvent }) {
  const [messages, setMessages] = useState(seed);
  const [running, setRunning] = useState(false);
  const [menu, setMenu] = useState(false);
  const runtime = useExternalStoreRuntime({
    messages, setMessages, isRunning: running,
    convertMessage: message => message,
    async onNew(message) {
      const text = message.content.find(part => part.type === 'text')?.text || '';
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text }] }]);
      setRunning(true); onEvent?.('new');
      await new Promise(resolve => setTimeout(resolve, 50));
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: [{ type: 'text', text: `Эхо: ${text}` }] }]);
      setRunning(false);
    },
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className="spike-thread">
      <ThreadPrimitive.Viewport className="spike-viewport">
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="spike-composer" onKeyDown={event => { if (event.key === '@') setMenu(true); if (event.key === 'Escape') setMenu(false); }}>
        {menu && <div role="listbox" className="spike-menu" data-testid="spike-menu"><div role="option" aria-selected="true">hero.tpl</div><div role="option">pricing</div></div>}
        <ComposerPrimitive.Input className="spike-input" placeholder="Напишите @ для меню" data-testid="spike-input" />
        <ComposerPrimitive.Send className="spike-send" data-testid="spike-send">Отправить</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}
