'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const sourcePath = path.resolve(__dirname, '..');
  const extensionDevelopmentPath = process.env.TPL_EXTENSION_PATH ? path.resolve(process.env.TPL_EXTENSION_PATH) : sourcePath;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tpl-vscode-test-'));
  try {
    const workspace = path.join(temporary, 'workspace');
    await fs.cp(path.join(sourcePath, 'examples'), workspace, { recursive: true });
    const candidates = process.env.VSCODE_EXECUTABLE_PATH ? [process.env.VSCODE_EXECUTABLE_PATH] :
      process.platform === 'darwin' ? ['Code', 'Electron'].map(name => `/Applications/Visual Studio Code.app/Contents/MacOS/${name}`) : [];
    let executable;
    for (const candidate of candidates) {
      if (await fs.stat(candidate).then(() => true, () => false)) { executable = candidate; break; }
    }
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath: path.join(sourcePath, 'test', 'extension-host.js'),
      ...(executable ? { vscodeExecutablePath: executable } : { version: 'stable' }),
      launchArgs: [workspace, '--disable-extensions', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        `--user-data-dir=${path.join(temporary, 'user-data')}`, `--extensions-dir=${path.join(temporary, 'extensions')}`],
    });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
