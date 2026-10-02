import test from 'node:test';
import assert from 'node:assert/strict';
import { runHostConformance, ConflictError, PolicyError, ValidationError, TransportError, runOperation, LIMITS, createZip, readZipProject } from '@trafficops/template-editor-core';
import { createStudioHost } from '../src/hosts/StudioHost.js';
import { createHttpHost } from '../embedded/src/HttpHost.js';
import { MemoryDirectoryHandle } from './support/fs-access.js';
import { httpServer } from './support/http-server.js';

import { thirdHost } from './support/third-host.js';
import { createStudioAiPort } from '../src/hosts/StudioAiPort.js';
import { createConversationSession } from '@trafficops/template-editor-shell/conversation-runtime';
const knownIds = ['safe-html-v1', 'fast-landings-v1'];
const source = '@layout\n<h1>Local project</h1>\n@endlayout';
test('StudioHost conforms using the actual File System Access adapter', async () => {
  const directory = new MemoryDirectoryHandle('Local', { 'index.tpl': source });
  const result = await runHostConformance(() => createStudioHost({ directory }), { knownIds, faults: {
    validation: host => host.project.import(new Uint8Array([0, 1])),
    policy: async host => host.project.export(await host.project.open(), { format: 'source', locale: 'en', history: { group: 'drafts', id: '1' } }),
  } });
  assert.ok(result.checks.includes('concurrency'));
});
test('HttpHost conforms through the JSON/base64 and HTTP status boundaries', async () => {
  const server = httpServer();
  await runHostConformance(() => createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', fetchImpl: server.fetchImpl }), { knownIds, faults: {
    validation: host => host.project.import(new Uint8Array([0])),
    policy: host => { server.fail({ status: 403 }); return host.project.open(); },
    transport: host => { server.fail(new TypeError('Network failed')); return host.project.open(); },
  } });
});

test('third host conforms without inheriting safe HTML or server lifecycle assumptions', async () => {
  await runHostConformance(thirdHost, { knownIds });
  const host = thirdHost(), state = await host.project.open();
  assert.equal(host.capabilities.inlinePreview, true); assert.equal((await host.analyzer.analyze(state)).previewAvailable, false);
  await assert.rejects(host.analyzer.render(state, { locale: 'en' }), e => e.code === 'policy');
});
test('AI-enabled StudioHost and HttpHost conform with a conversations port; dropping it is rejected', async () => {
  const ai = () => createStudioAiPort({ storage: { load: async () => ({ apiKey: '', model: '', imageModel: '' }), save: async value => value, remove: async () => {} } });
  const studio = () => createStudioHost({ directory: new MemoryDirectoryHandle('Local', { 'index.tpl': source }), ai: ai() });
  const http = () => createHttpHost({ endpoint: 'https://app.test/project', aiEndpoint: 'https://app.test/ai', csrf: 'csrf', fetchImpl: httpServer({ aiEnabled: true, conversationsEnabled: true }).fetchImpl });
  for (const factory of [studio, http]) {
    const sample = await factory();
    assert.equal(sample.capabilities.ai, true); assert.equal(typeof sample.conversations.load, 'function'); await sample.dispose?.();
    assert.ok((await runHostConformance(factory, { knownIds })).checks.includes('concurrency'));
    await assert.rejects(runHostConformance(async () => { const { conversations, ...rest } = await factory(); return rest; }, { knownIds }), /conversations port/);
  }
});
test('HttpHost without host conversation endpoints exposes no AI chat and still conforms', async () => {
  for (const conversationsEnabled of [undefined, false, 'yes']) {
    const factory = () => createHttpHost({ endpoint: 'https://app.test/project', aiEndpoint: 'https://app.test/ai', csrf: 'csrf', fetchImpl: httpServer({ aiEnabled: true, conversationsEnabled }).fetchImpl });
    const host = await factory();
    assert.equal(host.capabilities.ai, false); assert.equal(Object.hasOwn(host, 'ai'), false); assert.equal(Object.hasOwn(host, 'conversations'), false);
    assert.equal((await host.project.open()).availability.ai, false);
    await runHostConformance(factory, { knownIds });
  }
});
test('HttpHost AI history persists through the host conversation endpoints and reloads in a fresh host', async t => {
  const server = httpServer({ aiEnabled: true, conversationsEnabled: true });
  const options = { endpoint: 'https://app.test/project', aiEndpoint: 'https://app.test/ai', csrf: 'csrf', fetchImpl: server.fetchImpl };
  const host = await createHttpHost(options), opened = await host.project.open(), large = 'a'.repeat(5000);
  assert.equal(opened.availability.ai, true);
  const project = async value => ({ files: { ...value.files, 'styles.css': 'body { color: green; }' }, values: value.values, valid: true, summary: 'Styled' });
  const workflows = { intent: async () => ({ intent: 'source' }), project, file: project, block: project, discussion: project };
  const session = createConversationSession(host, { workflows, locks: null, sessionId: 'owner' }); t.after(() => session.dispose());
  await session.ready;
  const threadId = await session.submit({ prompt: 'Make it green', snapshot: { ...opened, files: { ...opened.files, 'large.css': large } } });
  for (let tick = 0; tick < 400 && session.getSnapshot().runs[0]?.state !== 'ready'; tick++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(session.getSnapshot().runs[0]?.state, 'ready');
  const written = server.calls.filter(call => call.init.method === 'PUT');
  assert.ok(written.some(call => call.url.startsWith('https://app.test/project/conversations/')));
  assert.ok(written.some(call => call.url.startsWith('https://app.test/project/conversation-blobs/')), 'a large snapshot file is uploaded as a blob');
  const loaded = await (await createHttpHost(options)).conversations.load();
  assert.equal(loaded.projectId, 'embed:/project');
  assert.deepEqual(loaded.threads.map(thread => thread.id), [threadId]);
  assert.equal(loaded.threads[0].messages[0].prompt, 'Make it green');
  assert.equal(loaded.runs[0].state, 'ready'); assert.equal(loaded.runs[0].result.files['styles.css'], 'body { color: green; }');
  assert.equal(loaded.runs[0].base.files['large.css'], large);
});
test('conformance rejects null optional ports rather than treating them as absent', async () => {
  await assert.rejects(runHostConformance(() => ({ ...thirdHost(), ai: null }), { knownIds }), /ai port/);
});
test('folder conflict retains dirty content until an explicit reload accepts disk changes', async () => {
  const directory = new MemoryDirectoryHandle('Local', { 'index.tpl': source, 'styles.css': 'old' });
  const host = createStudioHost({ directory }), state = await host.project.open();
  directory.children.get('styles.css').value = new TextEncoder().encode('external');
  const dirty = { ...state, files: { ...state.files, 'styles.css': 'local' } };
  await assert.rejects(host.project.save(dirty), e => e.code === 'conflict');
  await assert.rejects(() => host.project.save(dirty), error => error.code === 'conflict');
  const reloaded = await host.project.open();
  assert.notEqual(reloaded.revision, state.revision); assert.equal(reloaded.files['styles.css'], 'external');
  assert.equal(dirty.files['styles.css'], 'local');
  assert.equal(new TextDecoder().decode(directory.children.get('styles.css').value), 'external');
});
test('HTTP lifecycle keeps save+publish atomic and restore preserves unsaved files', async () => {
  const server = httpServer(), host = await createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', fetchImpl: server.fetchImpl });
  const state = await host.project.open();
  const published = await host.lifecycle.run('publish', { ...state, name: 'New name' }, { locale: 'en' });
  assert.equal(published.persisted, true); assert.equal(server.calls.filter(c => c.url.endsWith('/save')).length, 0);
  assert.equal(server.calls.filter(c => c.url.endsWith('/publish')).length, 1);
  const dirty = { ...published.state, files: { ...published.state.files, 'styles.css': 'unsaved' } };
  const restored = await host.lifecycle.run('restore', dirty, { locale: 'en', target: { group: 'publications', id: 'publication-1' } });
  assert.equal(restored.persisted, false); assert.equal(restored.state.files['styles.css'], 'unsaved');
});
test('host-managed AI exposes read/check/URL only and proxies the browser tool loop transport', async () => {
  const server = httpServer({ aiEnabled: true, conversationsEnabled: true }), host = await createHttpHost({ endpoint: 'https://app.test/project', aiEndpoint: 'https://app.test/ai', aiSettingsUrl: '/team/ai', csrf: 'csrf', fetchImpl: server.fetchImpl });
  assert.equal(host.ai.settings.owner, 'host'); assert.equal(host.ai.settings.url, '/team/ai');
  assert.equal('save' in host.ai.settings, false); assert.equal('remove' in host.ai.settings, false);
  const connection = await host.ai.begin();
  assert.equal(connection.timeoutMs, 900000);
  await connection.fetchImpl('https://openrouter.ai/api/v1/chat/completions', { body: JSON.stringify({ messages: [] }) });
  assert.equal(server.calls.at(-1).url, 'https://app.test/ai/chat');
  assert.equal(JSON.parse(server.calls.at(-1).init.body).run, 'opaque-session-token');
  await host.ai.finish(); assert.equal(server.calls.at(-1).url, 'https://app.test/ai/finish');
});

test('host-managed AI retains the safe provider error from the server proxy', async () => {
  const server = httpServer({ aiEnabled: true, conversationsEnabled: true });
  const host = await createHttpHost({ endpoint: 'https://app.test/project', aiEndpoint: 'https://app.test/ai', csrf: 'csrf', fetchImpl: server.fetchImpl });
  const connection = await host.ai.begin();
  server.fail({ status: 422, body: { error: { message: 'The AI provider returned an error (503). Try again.' } } });
  await assert.rejects(connection.fetchImpl('https://openrouter.ai/api/v1/chat/completions', { body: '{}' }), /AI provider returned an error \(503\)/);
  await host.ai.finish();
});

test('user-managed AI keeps credentials in its storage port and checks the direct connection', async () => {
  let value = { apiKey: 'user-owned-test-key', model: 'model', imageModel: '' };
  const calls = [];
  const ai = createStudioAiPort({ storage: { load: async () => value, save: async next => { value = next; return value; }, remove: async () => { value = { ...value, apiKey: '' }; } }, fetchImpl: async (url, init) => { calls.push({ url, init }); return Response.json({}); } });
  assert.equal(ai.settings.owner, 'user');
  await ai.settings.test(); assert.equal(calls[0].init.headers.Authorization, 'Bearer user-owned-test-key');
  const connection = await ai.begin(); assert.equal(connection.apiKey, value.apiKey);
  await assert.rejects(ai.begin(), e => e.code === 'conflict');
  await ai.finish(); await ai.settings.remove();
  assert.equal((await ai.settings.load()).configured, false);
});

test('HTTP host distinguishes template releases and live pages from their working drafts', async () => {
  const server = httpServer({ kind: 'template' });
  const host = await createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', fetchImpl: server.fetchImpl });
  assert.equal((await host.project.open()).status, 'Template draft');
  Object.assign(server.state(), { versionNumber: 3, hasUnreleasedChanges: false });
  assert.equal((await host.project.open()).status, 'Version 3 ready');
  server.state().hasUnreleasedChanges = true;
  assert.equal((await host.project.open()).status, 'Version 3 · draft changes');
  Object.assign(server.state(), { kind: 'page', status: 'draft' });
  assert.equal((await host.project.open()).status, 'Page draft');
  Object.assign(server.state(), { status: 'published', publishedNumber: 2, hasUnreleasedChanges: false });
  const published = await host.project.open();
  assert.equal(published.status, 'Publication 2 is live');
  assert.equal(published.actions[0].label, 'Publish changes');
  server.state().hasUnreleasedChanges = true;
  assert.equal((await host.project.open()).status, 'Publication 2 · draft changes');
  const russian = await createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', language: 'ru', fetchImpl: server.fetchImpl });
  assert.equal((await russian.project.open()).status, 'Публикация 2 · есть изменения в черновике');
});

test('HTTP template copy sends unsaved files and a separate template name, then installs the saved page revision', async () => {
  const server = httpServer(), host = await createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', fetchImpl: server.fetchImpl });
  const state = await host.project.open(), action = state.actions.find(action => action.id === 'save-template');
  assert.equal(action.input.value, state.name);
  assert.equal(action.input.maxLength, 120);
  const next = await host.lifecycle.run('save-template', { ...state, files: { ...state.files, 'styles.css': 'body { color: green; }' } }, { locale: 'en', inputValue: 'Botanical kit' });
  const sent = JSON.parse(server.calls.at(-1).init.body);
  assert.equal(sent.templateName, 'Botanical kit');
  assert.equal(sent.name, state.name);
  assert.equal(sent.files['styles.css'].text, 'body { color: green; }');
  assert.equal(next.state.revision, 2);
  assert.equal(next.persisted, true);
  assert.equal(next.notice, 'Saved to your team.');
});

test('initial AI requests are claimed with page revision before provider work and retain the prompt on failures', async () => {
  const server = httpServer({ aiEnabled: true, conversationsEnabled: true });
  const initialAiRequest = { id: 'request-1', prompt: 'Build a botanical landing', mode: 'create', autoStart: true };
  const host = await createHttpHost({ endpoint: 'https://app.test/project', csrf: 'csrf', aiEndpoint: 'https://app.test/ai', fetchImpl: server.fetchImpl, initialAiRequest });
  assert.equal(host.ai.initialRequest.prompt, initialAiRequest.prompt);
  server.fail({ status: 419, body: { message: 'Session expired' } });
  await assert.rejects(host.ai.initialRequest.claim(), /Session expired/);
  assert.equal(host.ai.initialRequest.prompt, initialAiRequest.prompt);
  assert.equal(server.calls.filter(call => call.url.endsWith('/start')).length, 0);
  assert.equal(await host.ai.initialRequest.claim(), true);
  assert.deepEqual(JSON.parse(server.calls.at(-1).init.body), { requestId: 'request-1', revision: 1 });
});
