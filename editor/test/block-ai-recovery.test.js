import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEditorPreview } from '@trafficops/template-runtime';
import { validateAiRecovery } from '../src/studio-ai-recovery.js';
import { createBlockEditScope, setBlockScopeValue } from '@trafficops/template-editor-shell/block-edit-scope';

function fixture() {
  const files = { 'index.tpl': '@type Comment\n@param text String\n@endtype\n@param comments Comment[]\n@layout\n<header>Keep</header>\n@each comment in comments:\n<article data-block="Comment">{{comment.text}}</article>\n@endeach\n@endlayout\n', 'styles.css': 'body{color:black}', 'asset.png': Uint8Array.of(1, 2, 3) };
  const rawValues = { comments: [{ text: 'First' }, { text: 'Second' }], retired: 'Retain this raw setting' };
  const trace = generateEditorPreview(files, rawValues);
  const scope = createBlockEditScope({ ...trace, version: 1, page: 'index.html', locale: 'en', selectedInstanceIds: [trace.blockInstances[1].id], intent: 'content' }, { files, rawValues, values: rawValues });
  return { files, rawValues, scope, record: { projectId: 'synthetic-block-project', token: 'synthetic-block-draft', baseRevision: 1, kind: 'edit', valid: true, files, values: setBlockScopeValue(scope, rawValues, ['comments', 1, 'text'], 'Updated second'), editScope: scope } };
}

test('recovery preserves selected instance, intent, unsaved baseline and untouched raw settings', () => {
  const { record, files, rawValues } = fixture();
  const recovered = validateAiRecovery(record);
  assert.equal(recovered.editScope.intent, 'content');
  assert.deepEqual(recovered.editScope.baselineFiles, files);
  assert.deepEqual(recovered.editScope.baselineRawValues, rawValues);
  assert.equal(recovered.values.comments[0].text, 'First');
  assert.equal(recovered.values.comments[1].text, 'Updated second');
  assert.equal(recovered.values.retired, rawValues.retired);
  record.editScope.baselineFiles['index.tpl'] = 'Tampered after validation';
  assert.notEqual(recovered.editScope.baselineFiles['index.tpl'], record.editScope.baselineFiles['index.tpl']);
});

test('recovery refuses outside-source and outside-value edits and never downgrades scoped mode', () => {
  const { record } = fixture();
  assert.throws(() => validateAiRecovery({ ...record, files: { ...record.files, 'styles.css': 'Changed globally' } }), /Unselected file/);
  assert.throws(() => validateAiRecovery({ ...record, values: { ...record.values, comments: [{ text: 'Changed sibling' }, record.values.comments[1]] } }), /Unselected field/);
  assert.throws(() => validateAiRecovery({ ...record, kind: 'create' }), /retain edit mode/);
  assert.throws(() => validateAiRecovery({ ...record, editScope: { ...record.editScope, version: 2 } }), /Invalid selection metadata/);
});

test('existing recovery records keep their old shape without a scope field', () => {
  const { record } = fixture();
  const { editScope, ...legacy } = record;
  assert.equal(Object.hasOwn(validateAiRecovery(legacy), 'editScope'), false);
});
