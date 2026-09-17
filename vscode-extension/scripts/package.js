'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createVSIX } = require('@vscode/vsce');
const manifest = require('../package.json');

async function main() {
  const cwd = path.resolve(__dirname, '..');
  const output = path.join(cwd, 'dist', `${manifest.name}-${manifest.version}.vsix`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await createVSIX({ cwd, packagePath: output, dependencies: false, allowMissingRepository: true, rewriteRelativeLinks: false });
  console.log(`VSIX ready: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
