import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const version = process.argv[2];
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Use a semantic vX.Y.Z tag');
for (const file of ['package.json', 'tops-cli/package.json', 'vscode-extension/package.json', 'packages/template-language/package.json', 'packages/template-editor-monaco/package.json', 'packages/template-editor-core/package.json', 'packages/template-editor-shell/package.json']) {
  assert.equal(JSON.parse(readFileSync(file)).version, version, `${file} version must match the tag`);
}
