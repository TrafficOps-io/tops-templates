import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const semver = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const read = file => JSON.parse(readFileSync(file));
const version = process.argv[2];
assert.match(version, semver, 'Use a semantic vX.Y.Z tag');
// Released in lockstep with the tag.
for (const file of ['package.json', 'tops-cli/package.json', 'vscode-extension/package.json', 'packages/template-language/package.json', 'packages/template-editor-monaco/package.json', 'packages/template-editor-core/package.json', 'packages/template-editor-shell/package.json']) {
  assert.equal(read(file).version, version, `${file} version must match the tag`);
}
// Versioned independently of the tag (studio-ui plan B): each needs a valid semantic
// version, and every workspace that depends on it pins exactly that version.
const independent = ['packages/studio-tokens/package.json', 'packages/studio-ui/package.json'];
const dependents = ['editor/package.json', 'packages/studio-ui/package.json', 'packages/template-editor-shell/package.json'];
for (const file of independent) {
  const {name, version: own} = read(file);
  assert.match(own, semver, `${file} needs a semantic version`);
  for (const dependent of dependents) {
    const manifest = read(dependent);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const range = manifest[field]?.[name];
      if (range !== undefined) assert.equal(range, own, `${dependent} ${field}.${name} must pin ${own}`);
    }
  }
}
