import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir(new URL('../../dist/', import.meta.url), { recursive: true });
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', './embedded', '--pack-destination=../dist'], { cwd: new URL('../', import.meta.url), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
