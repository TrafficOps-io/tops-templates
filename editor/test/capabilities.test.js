import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEditorCapabilities } from '../src/capabilities.js';

test('capabilities are opt-in and AI stays absent unless explicitly passed', () => {
  assert.equal(normalizeEditorCapabilities().ai, null);
  assert.equal(normalizeEditorCapabilities({ ai: true }).ai, null);
});

test('a host may inject an AI panel without coupling it to the public build', () => {
  const Panel = () => null;
  const capabilities = normalizeEditorCapabilities({ ai: { Panel, label: 'Draft with AI' } });
  assert.equal(capabilities.ai.Panel, Panel);
  assert.equal(capabilities.ai.label, 'Draft with AI');
  assert.equal(capabilities.ai.requiresDefinition, true);
  assert.ok(Object.isFrozen(capabilities));
});

test('a project-generating AI panel may render while a template is invalid', () => {
  const Panel = () => null;
  const capabilities = normalizeEditorCapabilities({ ai: { Panel, requiresDefinition: false } });
  assert.equal(capabilities.ai.requiresDefinition, false);
});
