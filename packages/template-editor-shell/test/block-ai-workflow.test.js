import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runBlockAiWorkflow } from '../src/block-ai-workflow.js';
import { assertBlockDraftScope } from '../src/block-edit-scope.js';

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const call = (toolName, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] });
const done = () => ({ content: [{ type: 'text', text: 'Done.' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] });
const plan = intent => call('submit_plan', { intent, summary: 'Edit only the selected blocks.', tasks: ['Edit the selected block', 'Review changes'] });
const review = (issues = []) => call('submit_review', { approved: !issues.length, summary: issues.length ? 'Repair requested change.' : 'The requested change is complete.', issues });
const model = responses => new MockLanguageModelV4({ doGenerate: responses });
const validateDraft = async ({ files, values }) => ({ files, values });
function setup() {
  const content = '<article data-block="Comment"><p>{{item.body}}</p></article>';
  const files = { 'index.tpl': `@layout\n<header>Keep</header>\n${content}\n@endlayout`, 'styles.css': 'body { color: black }', 'asset.png': Uint8Array.of(1, 2) };
  const rawValues = { comments: [{ body: 'First', author: 'Ada' }, { body: 'Second', author: 'Ben' }], shared: 'Keep', retired: 'Raw key stays' };
  const editScope = { version: 1, page: 'index.html', locale: 'en', blockSources: [{ id: 'comment', label: 'Comment', path: 'index.tpl', start: files['index.tpl'].indexOf(content), end: files['index.tpl'].indexOf(content) + content.length, content }],
    blockInstances: [{ id: 'first', sourceId: 'comment', label: 'Comment 1', page: 'index.html', valuePaths: [['comments', 0, 'body'], ['shared']] }, { id: 'second', sourceId: 'comment', label: 'Comment 2', page: 'index.html', valuePaths: [['comments', 1, 'body'], ['shared']] }],
    valueUses: [{ path: ['comments', 0, 'body'], instanceIds: ['first'], page: 'index.html' }, { path: ['comments', 1, 'body'], instanceIds: ['second'], page: 'index.html' }, { path: ['shared'], instanceIds: ['first', 'second'], page: 'index.html' }], selectedInstanceIds: ['first'] };
  return { mode: 'edit', prompt: 'Change the selected comment.', files, rawValues, values: structuredClone(rawValues), editScope, validateDraft };
}

test('source mode edits only the shared selected fragment and preserves raw settings despite host normalization', async () => {
  const initial = setup(), events = [], replacement = '<article data-block="Comment" style="padding: 20px"><p>{{item.body}}</p></article>';
  const languageModel = model([plan('source'), call('replace_block', { id: 'comment', content: replacement }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel, onProgress: event => events.push(event), validateDraft: async ({ files }) => ({ files, values: { comments: [] } }) });
  assert.equal(result.valid, true); assert.ok(result.files['index.tpl'].includes(replacement)); assert.deepEqual(result.values, initial.rawValues);
  assert.equal(result.files['styles.css'], initial.files['styles.css']); assert.deepEqual(result.files['asset.png'], initial.files['asset.png']);
  assert.equal(result.editScope.intent, 'source'); assert.equal(assertBlockDraftScope(result.editScope, { files: result.files, rawValues: result.values }), true);
  assert.deepEqual(events.filter(event => event.type === 'phase').map(event => event.phase), ['plan', 'generate', 'review', 'ready']);
  const writer = languageModel.doGenerateCalls[1];
  assert.ok(writer.tools.some(tool => tool.name === 'replace_block')); assert.ok(!writer.tools.some(tool => tool.name === 'set_block_value'));
  assert.deepEqual(initial.rawValues.comments.map(item => item.body), ['First', 'Second']);
});

test('content mode rejects shared/unselected/structural paths and unavailable source tools before a valid leaf edit', async () => {
  const initial = setup();
  const languageModel = model([plan('content'), call('set_block_value', { path: ['shared'], value: 'Bad' }), call('set_block_value', { path: ['comments', 1, 'body'], value: 'Bad' }),
    call('set_block_value', { path: ['comments'], value: [] }), call('replace_block', { id: 'comment', content: 'Bad' }), call('set_block_value', { path: ['comments', 0, 'body'], value: 'Selected only' }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel });
  assert.equal(result.valid, true); assert.deepEqual(result.files, initial.files); assert.equal(result.values.comments[0].body, 'Selected only');
  assert.equal(result.values.comments[1].body, 'Second'); assert.equal(result.values.shared, 'Keep'); assert.equal(result.values.retired, 'Raw key stays');
});

test('mixed mode supports appearance and one-instance content together', async () => {
  const initial = setup(), replacement = '<article data-block="Comment" class="updated"><p>{{item.body}}</p></article>';
  const languageModel = model([plan('mixed'), call('replace_block', { id: 'comment', content: replacement }), call('set_block_value', { path: '/comments/0/body', value: 'New first' }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel });
  assert.equal(result.valid, true); assert.equal(result.values.comments[0].body, 'New first'); assert.equal(result.values.comments[1].body, 'Second'); assert.ok(result.files['index.tpl'].includes(replacement));
});

test('ambiguous repeated-instance intent clarifies before writing or creating page assets', async () => {
  const initial = setup(), events = [];
  const languageModel = model([call('submit_plan', { intent: 'clarify', summary: 'Clarify repeated scope.', tasks: ['Clarify the requested instances'], clarification: 'Change only Comment 1 or every comment?' })]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel, attachments: [{ id: 'ref', name: 'reference.png', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4n+DwHwAGoAKfr+/eKAAAAABJRU5ErkJggg==', useOnPage: true }], generateImages: true, onProgress: event => events.push(event) });
  assert.equal(result.needsClarification, true); assert.equal(result.valid, false); assert.deepEqual(result.files, initial.files); assert.deepEqual(result.values, initial.rawValues);
  assert.equal(languageModel.doGenerateCalls.length, 1); assert.equal(events.some(event => event.type === 'file-set'), false);
  assert.ok(!languageModel.doGenerateCalls[0].tools.some(tool => tool.name === 'generate_image'));
});

test('review repairs keep fixed source/value scope and revalidate the actual changed draft', async () => {
  const initial = setup(), languageModel = model([plan('content'), call('set_block_value', { path: '/comments/0/body', value: 'Wrong' }), call('validate_draft', {}), review(['Use the requested copy.']),
    call('set_block_value', { path: '/comments/0/body', value: 'Correct' }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel });
  assert.equal(result.valid, true); assert.equal(result.values.comments[0].body, 'Correct'); assert.equal(result.values.comments[1].body, 'Second');
  assert.ok(JSON.stringify(languageModel.doGenerateCalls.at(-1).prompt).includes('Correct'));
});

test('host validation cannot alter the proposed source even inside the selected block', async () => {
  const initial = setup(), events = [];
  const languageModel = model([plan('source'), call('replace_block', { id: 'comment', content: '<article data-block="Comment" class="requested"><p>{{item.body}}</p></article>' }), call('validate_draft', {}), done()]);
  await assert.rejects(runBlockAiWorkflow({ ...initial, languageModel, onProgress: event => events.push(event), validateDraft: async ({ files, values }) => ({ files: { ...files, 'index.tpl': files['index.tpl'].replace('requested', 'unexpected') }, values }) }), /no changes/);
  assert.equal(events.some(event => event.phase === 'ready' || event.type === 'file-set'), false); assert.ok(!initial.files['index.tpl'].includes('requested'));
  assert.ok(JSON.stringify(languageModel.doGenerateCalls[2].prompt).includes('Host validation changed'));
});

test('continued recovery keeps original immutable baseline and cannot change intent', async () => {
  const initial = setup(), first = await runBlockAiWorkflow({ ...initial, languageModel: model([plan('content'), call('set_block_value', { path: '/comments/0/body', value: 'Recovered' }), call('validate_draft', {}), review()]) });
  const second = await runBlockAiWorkflow({ ...initial, files: first.files, rawValues: first.values, values: first.values, editScope: structuredClone(first.editScope), languageModel: model([plan('source')]) });
  assert.equal(second.needsClarification, true); assert.equal(second.editScope.intent, 'content'); assert.equal(second.values.comments[0].body, 'Recovered');
  assert.equal(second.editScope.baselineRawValues.comments[0].body, 'First');
  const continued = await runBlockAiWorkflow({ ...initial, files: first.files, rawValues: first.values, values: first.values, editScope: first.editScope,
    languageModel: model([plan('content'), call('set_block_value', { path: '/comments/0/body', value: 'Continued' }), call('validate_draft', {}), review()]) });
  assert.equal(continued.valid, true); assert.equal(continued.values.comments[0].body, 'Continued'); assert.equal(continued.values.comments[1].body, 'Second');
});

test('cancellation during review never publishes ready state or changes original data', async () => {
  const initial = setup(), controller = new AbortController(), events = [];
  const languageModel = new MockLanguageModelV4({ doGenerate: async input => {
    if (input.tools.some(tool => tool.name === 'submit_plan')) return plan('content');
    if (input.tools.some(tool => tool.name === 'submit_review')) { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); }
    return languageModel.doGenerateCalls.length === 2 ? call('set_block_value', { path: '/comments/0/body', value: 'Draft only' }) : call('validate_draft', {});
  } });
  await assert.rejects(runBlockAiWorkflow({ ...initial, languageModel, signal: controller.signal, onProgress: event => events.push(event) }), /cancelled/);
  assert.equal(initial.rawValues.comments[0].body, 'First'); assert.equal(events.some(event => event.phase === 'ready'), false);
});

test('streamed source writing only publishes completed scope-checked edits', async () => {
  const initial = setup(), responses = [plan('source'), call('replace_block', { id: 'comment', content: '<article data-block="Comment" style="padding: 10px"><p>{{item.body}}</p></article>' }), call('validate_draft', {}), review()], events = [];
  const languageModel = new MockLanguageModelV4({ doStream: async () => {
    const response = responses.shift();
    return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...response.content, { type: 'finish', finishReason: response.finishReason, usage }] }) };
  } });
  const result = await runBlockAiWorkflow({ ...initial, languageModel, stream: true, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.ok(result.files['index.tpl'].includes('padding: 10px')); assert.equal(languageModel.doStreamCalls.length, 4);
  assert.equal(events.some(event => event.partial), false); assert.equal(events.filter(event => event.type === 'file-set').length, 1);
});

test('mixed writing cannot introduce a new shared consumer before an otherwise permitted leaf edit', async () => {
  const initial = setup(), extra = '<aside data-block="Summary">{{detail}}</aside>';
  initial.files['index.tpl'] = initial.files['index.tpl'].replace('@endlayout', `${extra}\n@endlayout`);
  initial.rawValues.detail = 'Original detail'; initial.values.detail = 'Original detail';
  initial.editScope.blockSources.push({ id: 'summary', path: 'index.tpl', start: initial.files['index.tpl'].indexOf(extra), end: initial.files['index.tpl'].indexOf(extra) + extra.length, content: extra });
  initial.editScope.blockInstances.push({ id: 'summary-instance', sourceId: 'summary', page: 'index.html', valuePaths: [['detail']] });
  initial.editScope.valueUses.push({ path: ['detail'], instanceIds: ['summary-instance'], page: 'index.html' }); initial.editScope.selectedInstanceIds.push('summary-instance');
  const languageModel = model([plan('mixed'), call('replace_block', { id: 'comment', content: '<article data-block="Comment"><p>{{item.body}}</p><p>{{@root.detail}}</p></article>' }),
    call('set_block_value', { path: '/detail', value: 'Updated detail' }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel });
  assert.equal(result.valid, true); assert.equal(result.values.detail, 'Updated detail'); assert.deepEqual(result.files, initial.files);
  assert.ok(!result.files['index.tpl'].includes('@root.detail'));
  assert.ok(JSON.stringify(languageModel.doGenerateCalls[2].prompt).includes('new data dependencies'));
});

test('the run timeout interrupts a host that ignores cancellation and late validation cannot commit source', async () => {
  const initial = setup(), events = [];
  let finishValidation;
  const languageModel = model([plan('source'), call('replace_block', { id: 'comment', content: '<article data-block="Comment" class="new"><p>{{item.body}}</p></article>' }), call('validate_draft', {})]);
  await assert.rejects(runBlockAiWorkflow({ ...initial, languageModel, timeout: 30, onProgress: event => events.push(event), validateDraft: ({ files, values }) => new Promise(resolve => { finishValidation = () => resolve({ files, values }); }) }), /timed out/);
  const afterAbort = events.length;
  finishValidation?.(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(events.length, afterAbort); assert.equal(events.some(event => event.phase === 'ready' || event.type === 'file-set'), false);
  assert.ok(!initial.files['index.tpl'].includes('class="new"'));
});

test('invalid TPL is rejected by the real runtime before source reaches preview or recovery events', async () => {
  const { parseProject, generateProject } = await import('@trafficops/template-runtime');
  const initial = setup(), fragment = initial.editScope.blockSources[0].content;
  initial.files['index.tpl'] = `@type Comment\n@param body String\n@param author String\n@endtype\n@param comments Comment[]\n@layout\n<header>Keep</header>\n@each item in comments\n${fragment}\n@endeach\n@endlayout`;
  initial.editScope.blockSources[0].start = initial.files['index.tpl'].indexOf(fragment); initial.editScope.blockSources[0].end = initial.editScope.blockSources[0].start + fragment.length;
  const events = [], invalid = fragment.replace('{{item.body}}', '{{&item.body}}'), valid = fragment.replace('<article ', '<article style="padding: 12px" ');
  const languageModel = model([plan('source'), call('replace_block', { id: 'comment', content: invalid }), call('replace_block', { id: 'comment', content: valid }), call('validate_draft', {}), review()]);
  const result = await runBlockAiWorkflow({ ...initial, languageModel, onProgress: event => events.push(event), validateDraft: async ({ files, values }) => {
    const project = parseProject(files); generateProject(files, values, { locale: 'en' }, { draft: true }); return { files, values, definition: project.definition };
  } });
  assert.equal(result.valid, true); assert.equal(events.filter(event => event.type === 'file-set').length, 1);
  assert.ok(events.filter(event => event.files).every(event => !event.files['index.tpl'].includes('{{&item.body}}')));
  assert.ok(JSON.stringify(languageModel.doGenerateCalls[2].prompt).includes('Formatted output requires'));
});

test('provider streaming accepts queued takeInstructions without recursion and keeps scope fixed', async () => {
  const initial = setup(), requests = [], pending = ['Keep all authors unchanged.'];
  let writerStep = 0;
  const result = await runBlockAiWorkflow({ ...initial, apiKey: 'mock-key', model: 'test/provider', stream: true, takeInstructions: () => pending.splice(0), fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body); requests.push(body);
    const names = body.tools.map(item => item.function.name);
    const response = names.includes('submit_plan') ? plan('content') : names.includes('submit_review') ? review() : writerStep++ ? call('validate_draft', {}) : call('set_block_value', { path: '/comments/0/body', value: 'Provider first' });
    const content = response.content[0], delta = { role: 'assistant', tool_calls: [{ index: 0, id: content.toolCallId, type: 'function', function: { name: content.toolName, arguments: content.input } }] };
    const chunk = { id: 'scoped-provider-test', model: 'test/provider', choices: [{ index: 0, delta, finish_reason: response.finishReason.raw }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.equal(result.valid, true); assert.equal(result.values.comments[0].body, 'Provider first'); assert.equal(result.values.comments[1].body, 'Second');
  assert.equal(requests.length, 4); assert.ok(JSON.stringify(requests[0].messages).includes('Keep all authors unchanged.'));
  assert.ok(requests.slice(1).filter(request => !request.tools.some(item => item.function.name === 'submit_review')).every(request => !request.tools.some(item => item.function.name === 'replace_block')));
});
