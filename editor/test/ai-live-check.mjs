import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDefaults, parseProject, safePath } from '@trafficops/template-runtime';
import { runStudioAiWorkflow } from '@trafficops/template-editor-shell/studio-ai-workflow';
import { normalizeAiProviderError } from '../../packages/template-editor-shell/src/ai-provider-errors.js';
import { validateDraft } from './support/ai-validator.js';
import { OPTIHEART_BRIEF, optiheartInitialProject, optiheartCompletedLayout, optiheartCompletedValues, inspectOptiheartDraft } from './support/optiheart-ai-case.js';

// Default execution is entirely synthetic. --live is an explicit developer
// opt-in, never an authorization to spend the user's credits on its own.
const HELP = `Usage: node editor/test/ai-live-check.mjs [--dry-run] [--out /tmp/studio-ai-check] [--model model/id] [--mode edit|create]
  --fixture PATH       Optional exported PWA JSON {files, values|settings}; no connection settings.
  --live               Optional real-provider run, only after explicit user authorization.
  --max-calls N        Hard limit on POST requests (default 16).
  --max-cost USD       Stop before another call when reported cost reaches this limit (default 0.50).
  --timeout-ms N       Whole-run deadline (default 300000).
  --fail-planner-once  Synthetic-only HTTP 503 before any streamed tool input.
  --interrupt-writer  Synthetic-only failure after an already completed write.
Live mode requires STUDIO_OPENROUTER_TEST_KEY; the key is never logged or saved.
Known target models: openai/gpt-5-mini, qwen/qwen3.8-flash, xiaomi/mimo-v2.6-flash, google/gemini-3.8-flash.
Output: report.json, values.json, source/, rendered/. Dry runs prove local integration behavior, not real-provider reliability.`;

function parseArguments(args) {
  const options = { dryRun: true, model: process.env.STUDIO_OPENROUTER_TEST_MODEL || 'xiaomi/mimo-v2.6-flash', mode: 'edit', out: '/tmp/studio-ai-check', maxCalls: 16, maxCost: 0.5, timeoutMs: 300000 };
  const names = { '--out': 'out', '--model': 'model', '--mode': 'mode', '--fixture': 'fixture', '--max-calls': 'maxCalls', '--max-cost': 'maxCost', '--timeout-ms': 'timeoutMs' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { options.help = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--live') { options.dryRun = false; continue; }
    if (arg === '--fail-planner-once') { options.failPlannerOnce = true; continue; }
    if (arg === '--interrupt-writer') { options.interruptWriter = true; continue; }
    if (!names[arg] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${arg}`);
    options[names[arg]] = args[++index];
  }
  if (!['edit', 'create'].includes(options.mode)) throw new Error('--mode must be edit or create for the complete requested page.');
  for (const key of ['maxCalls', 'maxCost', 'timeoutMs']) {
    options[key] = Number(options[key]);
    if (!Number.isFinite(options[key]) || options[key] <= 0) throw new Error(`${key} must be positive.`);
  }
  if (!Number.isInteger(options.maxCalls)) throw new Error('--max-calls must be an integer.');
  if (!options.dryRun && (options.failPlannerOnce || options.interruptWriter)) throw new Error('Synthetic failure flags cannot be used with --live.');
  options.out = resolve(options.out);
  if (!options.out.startsWith('/tmp/') && !options.out.startsWith('/private/tmp/')) throw new Error('--out must be below /tmp; test outputs must not overwrite user projects.');
  return options;
}

function diagnostic(error, key, extras = {}) {
  const normalized = normalizeAiProviderError(error, { apiKey: key, ...extras });
  return Object.fromEntries(['name', 'message', 'statusCode', 'code', 'provider', 'generationId', 'retryable', 'cancelled'].filter(name => normalized[name] !== undefined).map(name => [name, normalized[name]]));
}

// Observe the actual SDK wire format without saving headers, prompts, source,
// tool arguments or full response bodies. Pass-through streaming stays live.
export function createMetricsFetch({ fetchImpl, apiKey, maxCalls = 16, maxCost = 0.5 }) {
  const calls = [], pending = new Set();
  let postCalls = 0;
  const cost = () => calls.reduce((sum, call) => sum + (call.usage?.cost || 0), 0);
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input));
    if (url.origin !== 'https://openrouter.ai' || !url.pathname.startsWith('/api/v1/')) throw new Error('The harness only permits the configured OpenRouter API destination.');
    if (init.method === 'POST' && (++postCalls > maxCalls || cost() >= maxCost)) throw new Error('Harness request or reported-cost budget reached; no further request was sent.');
    const started = performance.now(), record = { number: calls.length + 1, method: init.method || 'GET', endpoint: url.pathname, requestBytes: typeof init.body === 'string' ? Buffer.byteLength(init.body) : 0, responseBytes: 0 };
    if (typeof init.body === 'string') {
      const body = JSON.parse(init.body);
      record.model = body.model; record.toolChoice = body.tool_choice; record.temperaturePresent = Object.hasOwn(body, 'temperature');
      record.outputTokenLimit = body.max_tokens ?? body.max_completion_tokens; record.tools = body.tools?.map(tool => tool.function?.name).filter(Boolean);
      record.stage = record.tools?.length === 1 ? record.tools[0] : 'write';
      record.providerPolicy = body.provider ? { require_parameters: body.provider.require_parameters, data_collection: body.provider.data_collection } : undefined;
    }
    calls.push(record);
    let response;
    try { response = await fetchImpl(input, init); }
    catch (error) { record.seconds = (performance.now() - started) / 1000; record.error = diagnostic(error, apiKey); throw error; }
    record.status = response.status; record.headerSeconds = (performance.now() - started) / 1000;
    record.generationId = response.headers.get('X-Generation-Id') || undefined;
    let decoder = new TextDecoder(), buffered = '', settled = false, complete;
    const completion = new Promise(resolve => { complete = resolve; }); pending.add(completion);
    function inspect(payload) {
      if (typeof payload.id === 'string' && /^gen-[\w-]+$/.test(payload.id)) record.generationId = payload.id;
      if (typeof payload.provider === 'string') record.provider = payload.provider.slice(0, 100);
      if (payload.usage) {
        const usage = {};
        for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) if (typeof payload.usage[key] === 'number') usage[key] = payload.usage[key];
        record.usage = { ...record.usage, ...usage };
      }
      if (payload.error) record.error = diagnostic(payload, apiKey, { status: response.status, generationId: record.generationId });
    }
    const sse = /text\/event-stream/i.test(response.headers.get('Content-Type') || '');
    function consume(bytes, final = false) {
      buffered += decoder.decode(bytes, { stream: !final });
      if (sse) {
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline).trimEnd(); buffered = buffered.slice(newline + 1);
          if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
          try { inspect(JSON.parse(line.slice(5).trim())); } catch {}
        }
      } else if (final) { try { inspect(JSON.parse(buffered)); } catch {} buffered = ''; }
      if (buffered.length > 24 * 1024 * 1024) buffered = '';
    }
    function finish(error) {
      if (settled) return;
      settled = true; record.seconds = (performance.now() - started) / 1000;
      if (error) record.error = diagnostic(error, apiKey);
      else consume(undefined, true);
      pending.delete(completion); complete();
    }
    if (!response.body) { finish(); return response; }
    const reader = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { finish(); controller.close(); return; }
          record.firstByteSeconds ??= (performance.now() - started) / 1000;
          record.responseBytes += value.byteLength; consume(value); controller.enqueue(value);
        } catch (error) { finish(error); controller.error(error); }
      },
      async cancel(reason) { finish(reason instanceof Error ? reason : new Error('Response cancelled.')); await reader.cancel(reason); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  return { fetch, calls, reportedCost: cost, async settled() { await Promise.allSettled([...pending]); } };
}

function streamResponse(model, toolCalls = [], text = '', suffix = '') {
  const delta = toolCalls.length ? { role: 'assistant', tool_calls: toolCalls.map(([name, input], index) => ({ index, id: `${name}-${crypto.randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(input) } })) } : { content: text };
  const payload = { id: `gen-synthetic-${crypto.randomUUID()}`, model, choices: [{ index: 0, delta, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180, cost: 0 } };
  return new Response(`data: ${JSON.stringify(payload)}\n\n${suffix || 'data: [DONE]\n\n'}`, { headers: { 'Content-Type': 'text/event-stream' } });
}

export function createSyntheticOpenRouter({ initial, mode = 'edit', failPlannerOnce = false, interruptWriter = false, batchWrites = false } = {}) {
  let planning = 0, writing = 0;
  const completedSource = initial.files['index.tpl'].replace(/@layout\s*[\s\S]*?\s*@endlayout/, `@layout\n${optiheartCompletedLayout}\n@endlayout`);
  return async (_url, init) => {
    const body = JSON.parse(init.body), tools = body.tools?.map(tool => tool.function.name) || [];
    if (tools.includes('submit_plan')) {
      if (failPlannerOnce && !planning++) return Response.json({ error: { code: 503, message: 'Synthetic upstream unavailable before tool input.' } }, { status: 503 });
      return streamResponse(body.model, [['submit_plan', { summary: 'Polski prelanding OptiHeart z trzema miejscami na wideo, scenariuszem i miejscami na potwierdzone dane.', tasks: ['Translate existing visible content and HTML language', 'Add doctor, vessels and bypass video placeholders', 'Keep statistics and product details as explicitly unverified placeholders', 'Check mobile layout and independently review'] }]]);
    }
    if (tools.includes('submit_review')) return streamResponse(body.model, [['submit_review', { approved: true, summary: 'The actual rendered draft has Polish copy, three video placeholders, source placeholders, a clearly fictional doctor and the CTA.', issues: [] }]]);
    const step = writing++;
    if (mode === 'create') {
      if (step === 0) return streamResponse(body.model, [['set_file', { path: 'index.tpl', content: completedSource }], ['set_file', { path: 'styles.css', content: initial.files['styles.css'] }], ['set_file', { path: 'script.js', content: initial.files['script.js'] }]]);
      if (step === 1) return streamResponse(body.model, [['set_values', { values: optiheartCompletedValues }]]);
    } else {
      if (batchWrites && !interruptWriter) {
        if (step === 0) return streamResponse(body.model, [['set_values', { values: optiheartCompletedValues }], ['edit_file', { path: 'index.tpl', search: initial.files['index.tpl'].match(/@layout\s*([\s\S]*?)\s*@endlayout/)[1], replace: optiheartCompletedLayout }]]);
        return streamResponse(body.model, [['validate_draft', {}]]);
      }
      if (step === 0) return streamResponse(body.model, [['set_values', { values: optiheartCompletedValues }]]);
      if (step === 1 && interruptWriter) {
        const partial = JSON.stringify({ path: 'index.tpl', search: initial.files['index.tpl'].match(/@layout\s*([\s\S]*?)\s*@endlayout/)[1], replace: optiheartCompletedLayout }).slice(0, 130);
        const delta = { id: 'gen-synthetic-interrupted', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'partial-layout', type: 'function', function: { name: 'edit_file', arguments: partial } }] }, finish_reason: null }] };
        return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify({ error: { code: 503, message: 'Synthetic provider stream interrupted after tool input started.' } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (step === 1) return streamResponse(body.model, [['edit_file', { path: 'index.tpl', search: initial.files['index.tpl'].match(/@layout\s*([\s\S]*?)\s*@endlayout/)[1], replace: optiheartCompletedLayout }]]);
    }
    return streamResponse(body.model, [['validate_draft', {}]]);
  };
}

async function loadFixture(file) {
  if (!file) return { ...optiheartInitialProject(), provenance: 'synthetic representative persisted Russian health/news project; not the user PWA database' };
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  if (!fixture.files || typeof fixture.files !== 'object') throw new Error('Fixture must contain files; export project content without connection settings.');
  const files = Object.fromEntries(Object.entries(fixture.files).map(([path, content]) => {
    safePath(path);
    return [path, typeof content === 'string' ? content : Array.isArray(content) ? Uint8Array.from(content) : typeof content?.base64 === 'string' ? Uint8Array.from(Buffer.from(content.base64, 'base64')) : Uint8Array.from(Object.values(content))];
  }));
  const definition = parseProject(files).definition;
  return { files, definition, values: fixture.values || fixture.settings || getDefaults(definition), provenance: 'supplied exported project fixture' };
}

async function saveFiles(folder, files) {
  for (const [path, content] of Object.entries(files || {})) { safePath(path); const target = join(folder, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); }
}

export async function runHarness(options) {
  const initial = await loadFixture(options.fixture), synthetic = options.dryRun;
  const apiKey = synthetic ? 'synthetic-no-paid-requests' : process.env.STUDIO_OPENROUTER_TEST_KEY;
  if (!apiKey) throw new Error('Live mode requires STUDIO_OPENROUTER_TEST_KEY. No request was sent.');
  if (synthetic && options.fixture) throw new Error('Synthetic canned edits apply only to the representative fixture; use the supplied fixture for an explicitly authorized live run.');
  const tracker = createMetricsFetch({ apiKey, maxCalls: options.maxCalls, maxCost: options.maxCost,
    fetchImpl: synthetic ? createSyntheticOpenRouter({ initial, ...options }) : globalThis.fetch });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Harness whole-run deadline reached.')), options.timeoutMs);
  const start = performance.now(), events = []; let retained = { files: initial.files, values: initial.values }, result, failure, inspection;
  try {
    result = await runStudioAiWorkflow({ ...initial, mode: options.mode, prompt: OPTIHEART_BRIEF, apiKey, model: options.model, stream: true, generateImages: false, validateDraft, signal: controller.signal, fetchImpl: tracker.fetch,
      onProgress(event) {
        if (event.files && !event.partial) retained = { files: event.files, values: event.values || retained.values };
        if (event.values && !event.partial) retained.values = event.values;
        events.push({ seconds: (performance.now() - start) / 1000, type: event.type, phase: event.phase, step: event.step, tool: event.tool, valid: event.valid, providerSeconds: event.seconds });
      } });
    retained = result;
    inspection = inspectOptiheartDraft(result); inspection.checks.independentReviewApproved = result.valid === true && result.review?.approved === true && result.review.issues?.length === 0;
  } catch (error) { failure = diagnostic(error, apiKey); }
  finally { clearTimeout(timer); await tracker.settled(); }
  await mkdir(options.out, { recursive: true });
  await saveFiles(join(options.out, 'source'), retained.files);
  await writeFile(join(options.out, 'values.json'), JSON.stringify(retained.values, null, 2));
  if (inspection) await saveFiles(join(options.out, 'rendered'), inspection.rendered);
  const report = { kind: synthetic ? 'synthetic-provider-integration-regression' : 'real-openrouter-verification', fixture: initial.provenance, model: options.model, mode: options.mode, prompt: OPTIHEART_BRIEF,
    paidRequests: synthetic ? 0 : tracker.calls.filter(call => call.method === 'POST').length, syntheticRequests: synthetic ? tracker.calls.length : 0,
    seconds: (performance.now() - start) / 1000, reportedCost: tracker.reportedCost(), costLimitMeaning: 'Limit applies to returned usage cost; missing cost is unknown and a single response can cross the threshold. Hard POST count and whole-run deadline always apply.',
    calls: tracker.calls, events, result: { valid: result?.valid, summary: result?.summary, plan: result?.plan, review: result?.review, steps: result?.steps }, error: failure,
    checks: inspection?.checks, missingLocalAssets: inspection?.missingLocalAssets, videoPlaceholderCount: inspection?.videoPlaceholderCount,
    manualChecks: inspection?.manualChecks || ['Generation did not finish; inspect retained source and values before continuing.'],
    passed: !failure && !!inspection && Object.values(inspection.checks).every(value => value === true) };
  await writeFile(join(options.out, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else { const report = await runHarness(options); console.log(JSON.stringify({ passed: report.passed, kind: report.kind, paidRequests: report.paidRequests, seconds: report.seconds, report: join(options.out, 'report.json'), error: report.error }, null, 2)); if (!report.passed) process.exitCode = 1; }
  } catch (error) { console.error(diagnostic(error, process.env.STUDIO_OPENROUTER_TEST_KEY).message); process.exitCode = 1; }
}
