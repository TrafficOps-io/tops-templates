import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { parseProject, getDefaults } from '@trafficops/template-runtime';
import { runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { createAiDraftValidator } from '@trafficops/template-editor-shell/validate-ai-draft';
import { createStudioHost } from '../src/hosts/StudioHost.js';
import { validateDraft } from './support/ai-validator.js';
import { starterProject } from '../src/starter.js';

// The default Landing Studio path (spec 2.6): one agent loop per message.
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const toolPart = (name, input) => ({ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName: name, input: JSON.stringify(input) });
const respond = (...content) => ({ content, finishReason: { unified: content.some(part => part.type === 'tool-call') ? 'tool-calls' : 'stop', raw: 'stop' }, usage, warnings: [] });
const call = (name, input) => respond(toolPart(name, input));
const text = value => ({ type: 'text', text: value });
const plan = () => call('submit_plan', { summary: 'Add the footer.', tasks: ['Add the footer'], imageRequests: [] });
const review = (issues = []) => call('submit_review', { approved: !issues.length, summary: issues.length ? 'A blocking issue remains.' : 'The draft matches the request.', issues });
const toolNames = request => (request.tools || []).map(tool => tool.name).sort();
const footerEdit = () => call('edit_file', { path: 'index.tpl', search: '</body>', replace: '<footer>Updated footer</footer></body>' });
const content = () => { const files = starterProject(); const { definition } = parseProject(files); return { files, definition, values: getDefaults(definition) }; };

test('a small source edit takes two provider calls: no intent, plan or review stage', async () => {
  const files = starterProject(true), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [footerEdit(), respond(text('Added the footer.'), toolPart('validate_draft', {}))] });
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Add a footer.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.match(result.files['index.tpl'], /Updated footer/);
  assert.equal(result.summary, 'Added the footer.');
  assert.equal(model.doGenerateCalls.length, 2);
  for (const request of model.doGenerateCalls) {
    assert.deepEqual(toolNames(request).filter(name => ['submit_plan', 'submit_review', 'select_intent'].includes(name)), []);
    assert.ok(toolNames(request).includes('plan_changes') && toolNames(request).includes('review_draft'), 'optional subagents are available as tools');
  }
  assert.equal(events.some(event => event.type === 'plan' || event.type === 'review'), false);
  assert.deepEqual(events.filter(event => event.type === 'tool-step' && event.status !== 'running').map(event => [event.tool, event.status, event.path]),
    [['edit_file', 'done', 'index.tpl'], ['validate_draft', 'done', undefined]]);
  assert.deepEqual(events.filter(event => event.type === 'text-delta').map(event => event.delta), ['Added the footer.']);
});

test('provider-call count for the same small edit: staged pipeline 4 calls (+1 intent in the runtime), agent loop 2', async () => {
  const files = starterProject(true);
  const staged = new MockLanguageModelV4({ doGenerate: [plan(), footerEdit(), call('validate_draft', {}), review()] });
  const before = await runStudioAiWorkflow({ staged: true, mode: 'edit', files, values: { title: 'Original' }, prompt: 'Add a footer.', languageModel: staged, validateDraft });
  const agent = new MockLanguageModelV4({ doGenerate: [footerEdit(), call('validate_draft', {})] });
  const after = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Add a footer.', languageModel: agent, validateDraft });
  assert.equal(before.valid, true); assert.equal(after.valid, true);
  assert.equal(before.files['index.tpl'], after.files['index.tpl']);
  assert.equal(staged.doGenerateCalls.length, 4); assert.equal(agent.doGenerateCalls.length, 2);
});

test('a question is answered in one call without changes or a validation pass', async () => {
  const files = starterProject(true); let validations = 0;
  const model = new MockLanguageModelV4({ doGenerate: [respond(text('The page has a single title field.'))] });
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'What fields does this page have?', languageModel: model,
    validateDraft: options => { validations++; return validateDraft(options); } });
  assert.equal(result.discussion, true); assert.equal(result.valid, true);
  assert.equal(result.summary, 'The page has a single title field.');
  assert.deepEqual(result.files, files); assert.equal(model.doGenerateCalls.length, 1); assert.equal(validations, 0);
});

test('the content scope restricts tools to field values and still takes two calls for a small update', async () => {
  const initial = content();
  const model = new MockLanguageModelV4({ doGenerate: [call('set_values', { values: { headline: 'Nowy nagłówek' } }), respond(text('Updated the headline.'), toolPart('validate_draft', {}))] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Translate the headline to Polish.', languageModel: model, validateDraft });
  assert.equal(result.valid, true); assert.equal(result.values.headline, 'Nowy nagłówek'); assert.deepEqual(result.files, initial.files);
  assert.equal(model.doGenerateCalls.length, 2);
  assert.deepEqual(toolNames(model.doGenerateCalls[0]), ['plan_changes', 'review_draft', 'set_values', 'validate_draft']);
});

test('a content-scope request that needs source changes is explained, not rerun through the source pipeline', async () => {
  const initial = content();
  const model = new MockLanguageModelV4({ doGenerate: [respond(text('Adding three video sections needs Edit project: these fields cannot express new sections.'))] });
  const result = await runStudioAiWorkflow({ ...initial, mode: 'content', prompt: 'Add three video sections.', languageModel: model, validateDraft });
  assert.equal(result.discussion, true); assert.match(result.summary, /Edit project/);
  assert.equal(model.doGenerateCalls.length, 1);
});

test('plan_changes records the agent\'s own plan for free and review_draft runs the reviewer subagent on demand', async () => {
  const files = starterProject(true), events = [];
  const model = new MockLanguageModelV4({ doGenerate: [
    call('plan_changes', { tasks: ['Add the footer', 'Add an FAQ'] }),
    footerEdit(), call('validate_draft', {}),
    call('review_draft', { focus: 'FAQ present' }), review(['The FAQ is missing.']),
    call('edit_file', { path: 'index.tpl', search: '</footer>', replace: '</footer><section id="faq">FAQ</section>' }),
    respond(text('Added the footer and FAQ.'), toolPart('validate_draft', {})),
  ] });
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Add a footer and an FAQ.', languageModel: model, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.match(result.files['index.tpl'], /id="faq"/);
  assert.deepEqual(result.plan.tasks, ['Add the footer', 'Add an FAQ']);
  assert.equal(result.review.approved, false, 'the last review is reported; the agent fixed its finding');
  const reviewer = model.doGenerateCalls.filter(request => toolNames(request).join() === 'submit_review');
  assert.equal(reviewer.length, 1, 'one reviewer subagent call');
  assert.match(JSON.stringify(reviewer[0].prompt), /Updated footer/, 'the reviewer sees the actual current draft');
  assert.equal(model.doGenerateCalls.filter(request => toolNames(request).join() === 'submit_plan').length, 0, 'a plan with tasks needs no planner call');
  const fed = JSON.stringify(model.doGenerateCalls[5].prompt);
  assert.match(fed, /The FAQ is missing/, 'review findings return to the agent as the tool result');
  assert.deepEqual(events.filter(event => event.type === 'tool-step' && event.status === 'done').map(event => event.tool), ['plan_changes', 'edit_file', 'validate_draft', 'review_draft', 'edit_file', 'validate_draft']);
});

test('the validation gate still repairs an invalid draft before it can be returned as valid', async () => {
  const files = starterProject(true);
  const model = new MockLanguageModelV4({ doGenerate: [
    call('edit_file', { path: 'index.tpl', search: '@endlayout', replace: '' }), respond(text('Done.')),
    call('edit_file', { path: 'index.tpl', search: '</html>', replace: '</html>\n@endlayout' }), call('validate_draft', {}),
  ] });
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Tidy the layout.', languageModel: model, validateDraft });
  assert.equal(result.valid, true); assert.match(result.files['index.tpl'], /@endlayout/);
  assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /failed host validation/);
});

test('set_values validates once and validate_draft of the unchanged draft reuses it', async () => {
  const files = starterProject(true); let validations = 0, schemaOnly = 0;
  const counting = options => { if (options.schemaOnly) schemaOnly++; else validations++; return validateDraft(options); };
  const model = new MockLanguageModelV4({ doGenerate: [call('set_values', { values: { title: 'New title' } }), call('validate_draft', {})] });
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Change the title.', languageModel: model, validateDraft: counting });
  assert.equal(result.valid, true); assert.equal(result.values.title, 'New title');
  assert.deepEqual([validations, schemaOnly], [1, 0], 'one validation for set_values; validate_draft and the final gate are cached by revision');
});

test('the draft validator runs one analyzer pass when values already carry their defaults', async () => {
  const host = createStudioHost(), state = await host.project.open();
  let passes = 0;
  const analyzer = { analyze: (...args) => { passes++; return host.analyzer.analyze(...args); }, render: (...args) => host.analyzer.render(...args) };
  const validate = createAiDraftValidator(analyzer, () => state);
  const files = starterProject(true);
  await validate({ files, values: { title: 'Complete' } });
  assert.equal(passes, 1);
  passes = 0;
  await validate({ files, values: {} });
  assert.equal(passes, 2, 'missing defaults need a second pass that sees the effective values');
});

test('streamed text and tool steps reach progress while the provider is still sending', async () => {
  const files = starterProject(true), events = [], requests = [];
  const sse = chunks => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (requests.length === 1) return sse([{ id: 'gen-1', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Editing the footer. ' } }] },
      { id: 'gen-1', model: body.model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'edit-1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'index.tpl', search: '</body>', replace: '<footer>Streamed</footer></body>' }) } }] }, finish_reason: 'tool_calls' }] }]);
    return sse([{ id: 'gen-2', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Done.', tool_calls: [{ index: 0, id: 'validate-1', type: 'function', function: { name: 'validate_draft', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]);
  };
  const result = await runStudioAiWorkflow({ mode: 'edit', files, values: { title: 'Original' }, prompt: 'Add a footer.', apiKey: 'mock-key', model: 'qwen/qwen3.8-flash', stream: true, fetchImpl, validateDraft, onProgress: event => events.push(event) });
  assert.equal(result.valid, true); assert.equal(requests.length, 2);
  assert.deepEqual(events.filter(event => event.type === 'text-delta').map(event => event.delta).join(''), 'Editing the footer. \n\nDone.');
  const edit = events.filter(event => event.type === 'tool-step' && event.id === 'edit-1');
  assert.deepEqual(edit.map(event => event.status), ['running', 'running', 'done']);
  assert.equal(edit.at(-1).path, 'index.tpl');
  for (const request of requests) assert.deepEqual(request.provider, { require_parameters: true, allow_fallbacks: true, data_collection: 'deny' });
});
