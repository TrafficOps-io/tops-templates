import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const fixtures = dirname(fileURLToPath(import.meta.url)), repository = resolve(fixtures, '../../..');
const target = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'template-editor-consumer-'));
mkdirSync(target, { recursive: true }); mkdirSync(join(target, 'packages'), { recursive: true });
function npm(args, cwd) { const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit' }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`npm ${args[0]} exited ${result.status}`); }
const names = ['template-language', 'template-editor-core', 'template-editor-monaco', 'template-editor-shell'];
npm(['pack', ...names.map(name => `--workspace=@trafficops/${name}`), `--pack-destination=${join(target, 'packages')}`], repository);
const version = name => JSON.parse(readFileSync(join(repository, 'node_modules', name, 'package.json'))).version;
const dependencies = Object.fromEntries(['react', 'react-dom', 'monaco-editor', 'tailwindcss', 'daisyui'].map(name => [name, version(name)]));
for (const name of names) { const { version } = JSON.parse(readFileSync(join(repository, 'packages', name, 'package.json'))); dependencies[`@trafficops/${name}`] = `file:./packages/trafficops-${name}-${version}.tgz`; }
writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'independent-editor-consumer', private: true, type: 'module', scripts: { build: 'vite build' }, dependencies, devDependencies: Object.fromEntries(['vite', '@vitejs/plugin-react', '@tailwindcss/vite'].map(name => [name, version(name)])) }, null, 2));
for (const file of ['index.html', 'main.jsx', 'style.css', 'vite.config.js']) copyFileSync(join(fixtures, file), join(target, file));
copyFileSync(join(fixtures, '../support/third-host.js'), join(target, 'third-host.js'));
npm(['install', '--ignore-scripts', '--no-audit', '--no-fund'], target);
npm(['run', 'build'], target);
console.log(`Independent consumer: ${target}\nBrowser check: node editor/test/consumer/browser.mjs ${join(target, 'dist')}`);
