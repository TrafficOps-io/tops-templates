import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortLifecycle } from '../src/useChatPort.js';

function fakeSession() {
  const listeners = new Set(); let doc = { threads: [], runs: [] };
  return { listeners, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => doc, ready: Promise.resolve(), async reconcileApplied() {},
    set(next) { doc = next; for (const fn of listeners) fn(); } };
}
const thread = (id, extra = {}) => ({ id, title: 'T', createdAt: 1, updatedAt: 1, messages: [], ...extra });
const baseContext = () => ({ state: { files: {}, translations: {}, appliedAiRuns: [] }, t: text => text });

test('the port handed out before StrictMode cleanup keeps working after the second attach', () => {
  const session = fakeSession(), context = baseContext();
  const lifecycle = createPortLifecycle(session, () => context);
  const port = lifecycle.port;                       // как в рендере: до эффектов
  const seen = []; const off = port.threads.subscribe(value => seen.push(value));
  const stop1 = lifecycle.attach(); stop1();         // StrictMode: mount → cleanup
  const stop2 = lifecycle.attach();                  // → mount
  assert.equal(session.listeners.size, 1, 'exactly one live session subscription after re-attach');
  session.set({ threads: [thread('t1')], runs: [] });
  assert.equal(seen.at(-1)?.[0]?.id, 't1', 'subscriber registered on the pre-cleanup port is notified through the new adapter');
  assert.equal(port, lifecycle.port, 'port identity is stable');
  assert.equal(port.threads.get()[0].id, 't1');
  off(); stop2(); assert.equal(session.listeners.size, 0);
});

test('project changes invalidate conflicts without noise', () => {
  const session = fakeSession(), lifecycle = createPortLifecycle(session, baseContext);
  const stop = lifecycle.attach(); let notified = 0; lifecycle.port.threads.subscribe(() => notified++);
  lifecycle.onProjectChange(); assert.equal(notified, 0, 'no conflicts — no notification'); stop();
});

test('message subscribers survive re-attach and catch up with changes made while detached', () => {
  const session = fakeSession(), lifecycle = createPortLifecycle(session, baseContext), port = lifecycle.port;
  session.set({ threads: [thread('t1')], runs: [] });
  const seen = []; const off = port.messages('t1').subscribe(value => seen.push(value));
  lifecycle.attach()();
  session.set({ threads: [thread('t1', { messages: [{ id: 'm1', role: 'user', prompt: 'hi', createdAt: 1 }] })], runs: [] });
  const stop = lifecycle.attach();
  assert.equal(seen.at(-1)?.[0]?.id, 'm1', 'a fresh adapter hands current messages to existing subscribers');
  session.set({ threads: [thread('t1', { messages: [{ id: 'm1', role: 'user', prompt: 'hi', createdAt: 1 }, { id: 'm2', role: 'user', prompt: 'again', createdAt: 2 }] })], runs: [] });
  assert.equal(seen.at(-1)?.length, 2);
  off(); session.set({ threads: [thread('t1')], runs: [] }); assert.equal(seen.at(-1)?.length, 2, 'unsubscribed listener is not called');
  stop(); assert.equal(session.listeners.size, 0);
});

test('cleanup is idempotent and a late cleanup does not dispose the next adapter', () => {
  const session = fakeSession(), lifecycle = createPortLifecycle(session, baseContext);
  const seen = []; lifecycle.port.threads.subscribe(value => seen.push(value));
  const stop1 = lifecycle.attach(); stop1(); stop1();
  const stop2 = lifecycle.attach(); stop1();
  assert.equal(session.listeners.size, 1, 'stale cleanup left the live adapter alone');
  session.set({ threads: [thread('t2')], runs: [] }); assert.equal(seen.at(-1)?.[0]?.id, 't2');
  lifecycle.port.dispose(); assert.equal(session.listeners.size, 1, 'port.dispose() is a no-op: attach() owns the lifecycle');
  stop2(); stop2(); assert.equal(session.listeners.size, 0);
});

test('refresh after a UI language change re-labels snapshots and notifies subscribers', async () => {
  const session = fakeSession(); let t = text => text;
  const lifecycle = createPortLifecycle(session, () => ({ ...baseContext(), t })), stop = lifecycle.attach();
  const { id } = await lifecycle.port.createThread();
  const seen = []; lifecycle.port.threads.subscribe(value => seen.push(value));
  assert.equal(lifecycle.port.threads.get().find(item => item.id === id).title, 'New conversation');
  t = text => (text === 'New conversation' ? 'Новый диалог' : text);
  assert.equal(lifecycle.port.threads.get().find(item => item.id === id).title, 'New conversation', 'cached until refresh');
  lifecycle.refresh();
  assert.equal(seen.at(-1)?.find(item => item.id === id)?.title, 'Новый диалог');
  assert.equal(lifecycle.port.threads.get().find(item => item.id === id).title, 'Новый диалог');
  stop();
});
