import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('chat/port.d.ts type-checks in strict mode', () => {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '-p', fileURLToPath(new URL('../tsconfig.port.json', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
