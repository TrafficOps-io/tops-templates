import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAiRecovery } from '../src/studio-ai-recovery.js';
import { LIMITS } from '@trafficops/template-editor-core/project';

const source = '@layout\n<!doctype html><html lang="pl"><body>Polski szkic</body></html>\n@endlayout';
const png = new Uint8Array([137, 80, 78, 71]);
const attachment = () => ({ id: 'doctor-reference', name: 'Doctor.png', mime: 'image/png', dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, useOnPage: false });
const record = overrides => ({ projectId: 'landing-project', token: 'recovery-run-token', baseRevision: 3, kind: 'edit',
  files: { 'index.tpl': source, 'images/doctor.png': new Uint8Array([137, 80, 78, 71, 0, 255]) },
  values: { headline: 'Polski tytuł', cards: [{ title: 'Pełny artykuł', enabled: true, score: 0, details: { items: ['jeden', null, 'dwa'] } }] },
  attachments: [attachment()], prompt: 'Przetłumacz pełny artykuł i zachowaj zdjęcie.', generateImages: true,
  valid: false, steps: 16, clarifications: [], summary: 'Completed work is retained.', ...overrides });

test('AI recovery validation preserves a complete detached source, binary assets, reference and nested values', () => {
  const input = record(), recovered = validateAiRecovery(input);
  assert.deepEqual(recovered, input);
  assert.notEqual(recovered, input); assert.notEqual(recovered.files, input.files);
  assert.ok(recovered.files['images/doctor.png'] instanceof Uint8Array);
  assert.notEqual(recovered.files['images/doctor.png'].buffer, input.files['images/doctor.png'].buffer);
  input.files['images/doctor.png'][0] = 0;
  input.files['index.tpl'] = 'Changed source'; input.values.cards[0].details.items[0] = 'Changed'; input.attachments[0].name = 'Changed reference';
  assert.equal(recovered.files['images/doctor.png'][0], 137);
  assert.equal(recovered.files['index.tpl'], source);
  assert.equal(recovered.values.cards[0].details.items[0], 'jeden'); assert.equal(recovered.attachments[0].name, 'Doctor.png');
  recovered.values.cards[0].title = 'Changed recovered title'; recovered.files['images/doctor.png'][1] = 0;
  assert.equal(input.values.cards[0].title, 'Pełny artykuł'); assert.equal(input.files['images/doctor.png'][1], 80);
});

test('recovery clones only the binary view and does not retain unrelated backing-buffer bytes', () => {
  const backing = new Uint8Array([1, 2, 137, 80, 78, 71, 3, 4]), view = backing.subarray(2, 6);
  const recovered = validateAiRecovery(record({ files: { 'images/doctor.png': view } }));
  assert.deepEqual(recovered.files['images/doctor.png'], png);
  assert.equal(recovered.files['images/doctor.png'].byteLength, 4);
  assert.notEqual(recovered.files['images/doctor.png'].buffer, backing.buffer);
  backing.fill(0); assert.deepEqual(recovered.files['images/doctor.png'], png);
});

test('recovery keeps only allowed run data and discards connection, secret, error and review extras', () => {
  const secret = 'sk-or-never-persist-this-secret';
  const input = record({ apiKey: secret, connection: { apiKey: secret, fetchImpl: () => {} }, error: { message: secret }, review: { approved: true, secret },
    providerOptions: { headers: { authorization: secret } }, unknown: { nested: secret },
    attachments: [{ ...attachment(), apiKey: secret, connection: { secret }, error: secret }] });
  const recovered = validateAiRecovery(input);
  assert.equal(JSON.stringify(recovered).includes(secret), false);
  assert.deepEqual(Object.keys(recovered).sort(), ['attachments', 'baseRevision', 'clarifications', 'files', 'generateImages', 'kind', 'projectId', 'prompt', 'steps', 'summary', 'token', 'valid', 'values'].sort());
  assert.deepEqual(recovered.attachments, [attachment()]);
  assert.deepEqual(recovered.values, input.values, 'user content values remain intact');
});

test('recovery defaults omitted optional fields and preserves explicit image choices for all run kinds', () => {
  for (const kind of ['edit', 'content', 'create']) {
    const minimal = { projectId: 'project', token: 'run', baseRevision: 1, kind, files: { 'index.tpl': source }, valid: true };
    const recovered = validateAiRecovery(minimal);
    assert.equal(recovered.kind, kind); assert.equal(recovered.valid, true);
    assert.equal(recovered.prompt, ''); assert.equal(recovered.summary, ''); assert.equal(recovered.steps, 0);
    assert.deepEqual(recovered.values, {}); assert.deepEqual(recovered.attachments, []);
    assert.equal(Object.hasOwn(recovered, 'generateImages'), false);
    for (const generateImages of [true, false]) assert.equal(validateAiRecovery({ ...minimal, generateImages }).generateImages, generateImages);
  }
});

test('recovery rejects missing and malformed record identity, revision and execution state', () => {
  for (const value of [undefined, null, [], 42, 'record', new Date()]) assert.throws(() => validateAiRecovery(value));
  for (const key of ['projectId', 'token', 'baseRevision', 'kind', 'files', 'valid']) {
    const input = record(); delete input[key]; assert.throws(() => validateAiRecovery(input), key);
  }
  for (const key of ['projectId', 'token']) {
    for (const value of ['', ' ', 123, null, 'x'.repeat(161), 'bad\nidentity', 'bad\0identity', 'bad\u007fidentity']) {
      assert.throws(() => validateAiRecovery(record({ [key]: value })), `${key}: ${String(value).slice(0, 20)}`);
    }
  }
  for (const baseRevision of [0, -1, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateAiRecovery(record({ baseRevision })));
  for (const kind of ['landing', 'template', 'other', '', null]) assert.throws(() => validateAiRecovery(record({ kind })));
  for (const valid of [undefined, null, 'true', 1]) assert.throws(() => validateAiRecovery(record({ valid })));
  for (const steps of [-1, 65, 1.5, '16', null, Infinity]) assert.throws(() => validateAiRecovery(record({ steps })));
  for (const generateImages of [null, 'true', 1]) assert.throws(() => validateAiRecovery(record({ generateImages })));
  for (const steps of [32, 52, 64]) assert.equal(validateAiRecovery(record({ steps })).steps, steps, 'completed review/repair passes remain recoverable');
});

test('recovery checks prompt and summary limits without silently truncating them', () => {
  for (const [key, max] of [['prompt', 6000], ['summary', 5000]]) {
    const value = 'ą'.repeat(max);
    assert.equal(validateAiRecovery(record({ [key]: value }))[key], value);
    for (const invalid of ['x'.repeat(max + 1), null, 42, { text: 'wrong type' }]) assert.throws(() => validateAiRecovery(record({ [key]: invalid })), key);
  }
});

test('recovery rejects escaped or conflicting paths, invalid file contents, and projects beyond file limits', () => {
  for (const path of ['../secret.txt', '/tmp/secret.txt', 'dir/../secret.txt', 'dir\\secret.txt', '.hidden/file.txt', 'folder/file name.tpl', 'folder?query.tpl', 'constructor/file.txt']) {
    assert.throws(() => validateAiRecovery(record({ files: { [path]: 'Untrusted contents' } })), path);
  }
  for (const files of [undefined, null, [], {}, { 'index.tpl': 42 }, { 'index.tpl': new ArrayBuffer(3) }, { 'index.tpl': { content: source } }, { folder: 'file', 'folder/index.tpl': source }]) {
    assert.throws(() => validateAiRecovery(record({ files })));
  }
  assert.throws(() => validateAiRecovery(record({ files: { 'index.tpl': 'x'.repeat(LIMITS.text + 1) } })));
  assert.throws(() => validateAiRecovery(record({ files: { 'photo.png': new Uint8Array(LIMITS.file + 1) } })));
  assert.throws(() => validateAiRecovery(record({ files: Object.fromEntries(Array.from({ length: LIMITS.count + 1 }, (_, index) => [`file-${index}.txt`, 'x'])) })));
  const binary = new Uint8Array(LIMITS.file);
  assert.throws(() => validateAiRecovery(record({ files: { 'one.png': binary, 'two.png': binary, 'three.png': binary, 'four.png': binary, 'five.png': new Uint8Array([1]) } })));
});

test('recovery accepts only bounded JSON object values and rejects circular or non-JSON content', () => {
  for (const values of [null, [], new Date(), { bad: undefined }, { bad: () => {} }, { bad: 1n }, { bad: NaN }, { bad: Infinity }, { bad: new Uint8Array([1]) }]) {
    assert.throws(() => validateAiRecovery(record({ values })));
  }
  const cycle = {}; cycle.self = cycle; assert.throws(() => validateAiRecovery(record({ values: cycle })));
  let nested = {}; for (let index = 0; index < 66; index++) nested = { nested };
  assert.throws(() => validateAiRecovery(record({ values: nested })));
  assert.throws(() => validateAiRecovery(record({ values: { article: 'x'.repeat(LIMITS.text + 1) } })));
});

test('recovery revalidates reference count, unique IDs, safe media and actual image bytes', () => {
  for (const attachments of [null, {}, Array.from({ length: 5 }, (_, index) => ({ ...attachment(), id: `image-${index}` })),
    [attachment(), attachment()], [{ ...attachment(), id: '../private' }], [{ ...attachment(), mime: 'image/svg+xml' }],
    [{ ...attachment(), dataUrl: 'data:image/png;base64,YmFkLWltYWdl' }]]) {
    assert.throws(() => validateAiRecovery(record({ attachments })));
  }
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1); oversized.set(png);
  assert.throws(() => validateAiRecovery(record({ attachments: [{ ...attachment(), dataUrl: `data:image/png;base64,${Buffer.from(oversized).toString('base64')}` }] })));
});


test('recovery preserves detached complete user clarifications within the original eight-entry bound', () => {
  const clarifications = ['Keep the full Polish article.', 'Retain the completed doctor photo.'];
  const recovered = validateAiRecovery(record({ clarifications }));
  assert.deepEqual(recovered.clarifications, clarifications); clarifications[0] = 'Mutated';
  assert.equal(recovered.clarifications[0], 'Keep the full Polish article.');
  assert.deepEqual(validateAiRecovery(record({ clarifications: undefined })).clarifications, []);
  for (const invalid of [null, {}, [''], [' '], [42], ['x'.repeat(6001)], Array(9).fill('Valid instruction')]) assert.throws(() => validateAiRecovery(record({ clarifications: invalid })));
  assert.equal(validateAiRecovery(record({ clarifications: Array(8).fill('x'.repeat(6000)) })).clarifications.length, 8);
});
