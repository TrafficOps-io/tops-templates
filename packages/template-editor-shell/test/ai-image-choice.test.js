import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveImageGeneration } from '../src/ai-image-choice.js';

test('configured image generation defaults on while explicit run choices survive settings reloads', () => {
  assert.equal(resolveImageGeneration(undefined, null), false);
  assert.equal(resolveImageGeneration(undefined, { imageModel: ' ' }), false);
  assert.equal(resolveImageGeneration(undefined, { imageModel: 'test/image' }), true);
  assert.equal(resolveImageGeneration(false, { imageModel: 'test/image' }), false);
  assert.equal(resolveImageGeneration(false, { imageModel: 'test/other-image' }), false);
  // A requested image run without a model must reach the existing missing-model
  // validation rather than silently become a text-only run.
  assert.equal(resolveImageGeneration(true, { imageModel: '' }), true);
});
