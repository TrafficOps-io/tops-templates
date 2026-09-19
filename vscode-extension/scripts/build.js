'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { build } = require('esbuild');

async function buildExtension() {
  await build({
    entryPoints: [path.resolve(__dirname, '../src/extension.js')],
    outfile: path.resolve(__dirname, '../build/extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    legalComments: 'eof',
    logLevel: 'info',
  });
  const languageRequire = require('node:module').createRequire(require.resolve('@trafficops/template-language'));
  await fs.copyFile(languageRequire.resolve('prettier/LICENSE'), path.resolve(__dirname, '../build/PRETTIER-LICENSE'));
}

if (require.main === module) buildExtension().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildExtension };
