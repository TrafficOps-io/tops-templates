import test from 'node:test';
import assert from 'node:assert/strict';
import { aiToolValidationEvents } from '../../packages/template-editor-shell/src/ai-tool-validation.js';
import { createAiDiagnostics } from '../../packages/template-editor-shell/src/ai-diagnostics.js';
import { createOpenRouterTemplateModel, createTemplateDraftAgent } from '../../packages/template-editor-shell/src/openrouter-template-agent.js';

const secret = 'sk-or-tool-validation-private-secret';
const privatePath = 'private-project-source-name.tpl';
const privateSource = 'PRIVATE SOURCE TEXT';
const privateKey = 'PRIVATE ARGUMENT NAME';
const oversized = privateSource.repeat(800);
const source = '@layout\n<h1>Complete fixture</h1>\n@endlayout';
const cases = [
  ['oversized content', 'set_file', { path: privatePath, content: oversized }, { issueField: 'content', issueCode: 'too_big', inputChars: oversized.length, limit: 12000 }],
  ['missing content', 'set_file', { path: privatePath, contents: privateSource, [privateKey]: secret }, { issueField: 'content', issueCode: 'invalid_type' }],
  ['malformed JSON', 'set_file', `{"path":"${privatePath}","content":`, { issueField: 'input', issueCode: 'invalid_json' }],
  ['unknown tool', privateKey, { path: privatePath, content: privateSource }, { issueField: 'input', issueCode: 'unknown_tool' }],
];

for (const stream of [false, true]) for (const [label, name, input, expected] of cases) {
  test(`actual SDK ${stream ? 'stream' : 'completion'} reports safe ${label} validation without changing provider history`, async () => {
    const requests = [], events = [];
    const journal = createAiDiagnostics({ model: 'xiaomi/mimo-v2.6-flash', mode: 'create', apiKey: secret });
    const model = createOpenRouterTemplateModel({ apiKey: secret, model: 'xiaomi/mimo-v2.6-flash', fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      const step = requests.length;
      const toolName = step === 1 ? name : step === 2 ? 'set_file' : 'validate_draft';
      const argumentsValue = step === 1 ? input : step === 2 ? { path: 'index.tpl', content: source } : {};
      const call = { id: `fixture-${step}`, type: 'function', function: { name: toolName, arguments: typeof argumentsValue === 'string' ? argumentsValue : JSON.stringify(argumentsValue) } };
      const choice = stream ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }
        : { index: 0, message: { role: 'assistant', tool_calls: [call] }, finish_reason: 'tool_calls' };
      const payload = { id: `gen-free-validation-${step}`, choices: [choice] };
      return new Response(stream ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` : JSON.stringify(payload),
        { headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' } });
    } });
    const agent = createTemplateDraftAgent({ model, onProgress: event => { events.push(event); journal.record(event); },
      validateDraft: async ({ files, values }) => ({ files, values }) });
    const result = await agent.generate({ prompt: 'PRIVATE BRIEF: build the synthetic fixture.', stream });
    assert.equal(result.valid, true);
    assert.equal(result.files['index.tpl'], source);
    assert.equal(result.files[privatePath], undefined, 'invalid arguments never reach draft mutation');
    assert.equal(events.filter(event => event.type === 'file-set').length, 1);
    const diagnostics = events.filter(event => event.type === 'tool-validation');
    // The streaming adapter drops unparseable argument text before SDK schema
    // validation, so this fixture reports both missing fields rather than JSON.
    const expectedIssues = stream && label === 'malformed JSON' ? [
      { issueField: 'path', issueCode: 'invalid_type' }, { issueField: 'content', issueCode: 'invalid_type' },
    ] : [expected];
    assert.equal(diagnostics.length, expectedIssues.length, 'each distinct issue is reported once without a second completed-step notification');
    for (let index = 0; index < diagnostics.length; index++) {
      assert.equal(diagnostics[index].tool, name === privateKey ? 'unknown' : name);
      for (const [field, value] of Object.entries(expectedIssues[index])) assert.equal(diagnostics[index][field], value);
      assert.ok(diagnostics[index].message);
    }
    assert.equal(requests.length, 3);
    assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'fixture-1'), 'the original SDK failure feedback remains in provider conversation history');
    const exported = journal.finish();
    const entries = exported.events.filter(event => event.type === 'tool-validation');
    for (let index = 0; index < entries.length; index++) {
      assert.equal(entries[index].message, undefined, 'UI wording is excluded from exported diagnostics');
      for (const [field, value] of Object.entries(expectedIssues[index])) assert.equal(entries[index][field], value);
    }
    const text = JSON.stringify(exported) + JSON.stringify(diagnostics);
    for (const forbidden of [secret, privatePath, privateSource, privateKey, 'PRIVATE BRIEF', 'toolInput', 'cause']) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
}

test('journal rechecks tool/field/code enums and numeric bounds rather than trusting an incoming diagnostic', () => {
  const journal = createAiDiagnostics({ model: 'fixture', mode: 'create', apiKey: secret });
  const metadata = { type: 'tool-validation', tool: 'set_file', issueField: 'content', issueCode: 'too_big' };
  assert.equal(journal.record({ ...metadata, inputChars: 12001, limit: 12000, message: privateSource, error: secret,
    input: { path: privatePath, content: privateSource }, unknownArgumentKeys: [privateKey], files: { [privatePath]: privateSource } }), true);
  for (const bad of [{ tool: privateKey }, { issueField: privateKey }, { issueCode: privateSource }]) assert.equal(journal.record({ ...metadata, ...bad }), false);
  for (const invalidNumber of [-1, 1.5, NaN, Infinity, 16 * 1024 * 1024 + 1]) {
    assert.equal(journal.record({ ...metadata, inputChars: invalidNumber, limit: invalidNumber }), true);
  }
  const entries = journal.snapshot().events;
  assert.equal(entries.length, 6);
  assert.equal(entries[0].inputChars, 12001);
  assert.equal(entries[0].limit, 12000);
  for (const entry of entries.slice(1)) {
    assert.equal(entry.inputChars, undefined);
    assert.equal(entry.limit, undefined);
  }
  const exported = JSON.stringify(entries);
  for (const forbidden of [secret, privatePath, privateSource, privateKey, 'unknownArgumentKeys', 'message', '"input":']) {
    assert.equal(exported.includes(forbidden), false, forbidden);
  }
});

test('nested batch issues keep fixed fields while unknown property paths and oversized issue lists remain bounded', () => {
  const events = aiToolValidationEvents({ invalid: true, toolName: 'set_files', input: { files: [{ path: privatePath, content: oversized }] },
    error: { cause: { issues: [
      { code: 'too_big', origin: 'string', maximum: 12000, path: ['files', 0, 'content'] },
      { code: 'invalid_type', path: [privateKey, privatePath] },
      ...Array.from({ length: 100 }, () => ({ code: 'custom', path: ['files'] })),
    ] } } });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(({ issueField, issueCode }) => ({ issueField, issueCode })), [
    { issueField: 'content', issueCode: 'too_big' }, { issueField: 'input', issueCode: 'invalid_type' }, { issueField: 'files', issueCode: 'custom' },
  ]);
  assert.equal(events[0].inputChars, oversized.length);
  assert.equal(events[0].limit, 12000);
  for (const forbidden of [privateKey, privatePath, privateSource]) assert.equal(JSON.stringify(events).includes(forbidden), false);
  const cycle = {}; cycle.cause = cycle;
  assert.equal(aiToolValidationEvents({ invalid: true, toolName: 'set_file', error: cycle }).length, 1);
  assert.deepEqual(aiToolValidationEvents({ invalid: false, toolName: 'set_file', input: { content: oversized } }), []);
});
