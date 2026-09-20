import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpHost } from '../embedded/src/HttpHost.js';
import { httpServer } from './support/http-server.js';

async function fixture(handler) {
  const base = httpServer(), calls = [];
  const host = await createHttpHost({ endpoint: 'https://panel.test/project', csrf: 'panel-csrf', fetchImpl: (url, init) => {
    if (!url.includes('/live-preview')) return base.fetchImpl(url, init);
    const action = url.split('/').at(-1), data = JSON.parse(init.body);
    calls.push({ action, data, init }); return handler(action, data, calls.length);
  } });
  const state = await host.project.open();
  return { host, state, calls };
}
const reply = (id, extra = {}) => Response.json({ id, url: `https://content.test/${id}/index.html`, page: 'index.html', previewSessionId: 'session-id', previewSessionToken: 'private-session-token', ...extra });

test('HTTP live preview reuses its session, pins displayed revision and keeps grants outside author files', async () => {
  const { host, state, calls } = await fixture((action, data, index) => action === 'live-preview' ? reply(`revision-${index}`) : Response.json({ ok: true }));
  try {
    const first = await host.livePreview.render(state, { locale: 'en' });
    const second = await host.livePreview.render({ ...state, files: { ...state.files, 'app.js': 'window.changed=true' } }, { locale: 'uk', page: 'other.html', keepRevisionId: first.id });
    assert.equal(calls[0].data.previewSessionId, undefined);
    assert.equal(calls[1].data.previewSessionToken, 'private-session-token');
    assert.equal(calls[1].data.keepRevisionId, first.id);
    assert.equal(calls[1].data.previewPage, 'other.html');
    assert.equal(calls[1].data.editingLocale, 'uk');
    assert.equal(calls[1].data.files['app.js'].text, 'window.changed=true');
    assert.equal(JSON.stringify(second).includes('private-session-token'), false);
    assert.equal(calls[1].init.credentials, 'same-origin');
  } finally { await host.dispose(); }
  assert.equal(calls.at(-1).action, 'live-preview-close');
});

test('an expired live session is recreated without the expired displayed revision', async () => {
  let count = 0;
  const { host, state, calls } = await fixture(action => {
    if (action !== 'live-preview') return Response.json({ ok: true });
    if (++count === 2) return Response.json({ message: 'Expired' }, { status: 404 });
    return reply(`r${count}`);
  });
  try {
    const first = await host.livePreview.render(state, { locale: 'en' });
    const next = await host.livePreview.render(state, { locale: 'en', keepRevisionId: first.id });
    assert.equal(next.id, 'r3'); assert.equal(calls[2].data.previewSessionId, undefined); assert.equal(calls[2].data.keepRevisionId, undefined);
  } finally { await host.dispose(); }
});

test('aborting the first live render still captures and revokes its server session', async () => {
  let complete;
  const { host, state, calls } = await fixture(action => action === 'live-preview' ? new Promise(resolve => { complete = () => resolve(reply('aborted')); }) : Response.json({ ok: true }));
  const controller = new AbortController();
  const render = host.livePreview.render(state, { locale: 'en', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const rejected = assert.rejects(render, error => error.code === 'abort');
  const disposed = host.dispose(); complete(); await rejected; await disposed;
  assert.equal(calls.at(-1).action, 'live-preview-close');
  assert.equal(calls.at(-1).data.previewSessionToken, 'private-session-token');
});
