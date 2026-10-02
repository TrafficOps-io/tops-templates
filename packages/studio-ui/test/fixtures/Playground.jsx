import { useState } from 'react';
import { StudioUiProvider } from '../../src/i18n/StudioUiProvider.jsx';
import { Button, ConfirmDialog, InlineNotice, MentionChip, Menu, Tabs, ToastProvider, tabPanelProps, useToast } from '../../src/primitives/index.js';

const items = [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three' }];

function Content() {
  const [active, setActive] = useState('one'), [confirm, setConfirm] = useState(false), [chip, setChip] = useState(true), toast = useToast();
  return <>
    <Tabs id="pg-tabs" items={items} value={active} onChange={setActive} label="Playground tabs" />
    <div {...tabPanelProps('pg-tabs', active)}>Panel {active}</div>
    <Menu label="Actions" trigger="Actions">{({ close }) => <>
      {['Rename', 'Duplicate', 'Delete'].map(name => <button key={name} type="button" role="menuitem" onClick={() => close()}>{name}</button>)}
    </>}</Menu>
    <Button onClick={() => setConfirm(true)}>Open confirm</Button>
    <Button onClick={() => toast.push({ tone: 'danger', title: 'Ошибка' })}>toast</Button>
    <Button loading>Saving</Button>
    <InlineNotice tone="danger" title="Something failed">Details</InlineNotice>
    {chip && <MentionChip target={{ kind: 'section', label: 'Hero' }} onRemove={() => setChip(false)} />}
    <p id="outside">Outside</p>
    {confirm && <ConfirmDialog title="Delete project" description="This cannot be undone." danger onConfirm={() => setConfirm(false)} onClose={() => setConfirm(false)} />}
  </>;
}

export default function Playground() {
  return <div className="studio-root" data-theme="studio-dark">
    <StudioUiProvider language="en"><ToastProvider><Content /></ToastProvider></StudioUiProvider>
    <span id="focus-probe" style={{ color: 'var(--ui-focus)' }} />
  </div>;
}
