import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'vite';

// Exercise the supported optional-port fallback using the real Studio bundle.
// Production source/capabilities are unchanged; only the disposable test hosts
// omit conversations, as an embedded consumer without that port would do.
const outDir = resolve(process.argv[2] || '/tmp/studio-legacy-conversations');
await build({
  configFile: resolve('editor/vite.config.js'), root: resolve('editor'),
  build: { outDir, emptyOutDir: true },
  plugins: [{ name: 'legacy-conversation-port-fixture', enforce: 'pre', transform(code, id) {
    const host = id.endsWith('/editor/src/hosts/LibraryHost.js') ? 'createLibraryHost' : id.endsWith('/editor/src/hosts/StudioHost.js') ? 'createStudioHost' : null;
    if (!host) return;
    assert.ok(code.includes(`export function ${host}(`));
    return code.replace(`export function ${host}(`, `function ${host}WithConversations(`) + `\nexport function ${host}(...args) { const host = ${host}WithConversations(...args); delete host.conversations; return host; }\n`;
  } }],
});
console.log(`Legacy optional-port fixture built: ${outDir}`);
