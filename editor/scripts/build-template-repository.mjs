// Backwards-compatible publisher for bundled examples. The public CLI owns the format and validation.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRepository } from '../../tops-cli/src/repositories.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(process.argv[2] || `${root}/repositories/trafficops`);
const output = resolve(process.argv[3] || `${root}/editor/public/template-repositories/trafficops`);
const result = await bundleRepository(source, { output, force: true });
console.log(`Published ${result.index.templates.length} templates to ${result.output}`);
