import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiDiagnostics } from '../../packages/template-editor-shell/src/ai-diagnostics.js';

test('exported AI diagnostics contain timings and routing without project payloads or keys', () => {
  const apiKey = 'sk-or-diagnostics-secret', log = createAiDiagnostics({ model: 'google/test', mode: 'edit', apiKey });
  log.record({ type: 'request-start', request: 1, requestBytes: 4000, prompt: 'PRIVATE PROMPT', body: apiKey, files: { 'index.tpl': 'PRIVATE SOURCE' }, values: { title: 'PRIVATE VALUES' }, headers: { authorization: apiKey } });
  log.record({ type: 'file-stream', files: { 'index.tpl': 'PRIVATE SOURCE' } });
  log.record({ type: 'request-finished', seconds: 2, status: 200, generationId: `gen-test-${apiKey}`, usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40, raw: apiKey } });
  const report = log.finish({ code: 503, message: `Provider rejected ${apiKey}: PRIVATE PROMPT; PRIVATE SOURCE; PRIVATE VALUES` });
  const text = JSON.stringify(report);
  assert.equal(report.events.length, 3);
  assert.equal(report.events[1].generationId, 'gen-test-[redacted]');
  assert.equal(report.events[2].statusCode, 503);
  assert.equal(report.events[2].error, undefined);
  assert.match(text, /redacted/);
  for (const privateText of [apiKey, 'PRIVATE PROMPT', 'PRIVATE SOURCE', 'PRIVATE VALUES', 'authorization']) assert.equal(text.includes(privateText), false);
});
