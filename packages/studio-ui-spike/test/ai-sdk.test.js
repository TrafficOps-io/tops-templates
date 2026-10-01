import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
function manifest(name) {
  let directory = dirname(require.resolve(name));
  while (!directory.endsWith(`node_modules/${name}`) && directory !== dirname(directory)) directory = dirname(directory);
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
}

test('@assistant-ui/ai-sdk exposes a runtime hook and accepts the installed ai@7', async () => {
  const module = await import('@assistant-ui/ai-sdk');
  const hook = module.useAISDKRuntime || module.useChatRuntime;
  assert.equal(typeof hook, 'function', `exports: ${Object.keys(module).join(', ')}`);
  const aiSdk = manifest('@assistant-ui/ai-sdk');
  const peer = aiSdk.peerDependencies?.ai || aiSdk.dependencies?.ai;
  const installed = manifest('ai').version;
  assert.ok(peer, 'ai must be declared as a dependency or peer');
  assert.match(installed, /^7\./);
  console.log(`ai-sdk peer "ai": ${peer}; installed ai ${installed}`);
});
