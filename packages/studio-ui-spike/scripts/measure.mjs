import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
const external = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'];
async function size(contents, label) {
  const result = await build({ stdin: { contents, resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'jsx' }, bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'chrome120', external, define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', loader: { '.css': 'empty' } });
  const bytes = gzipSync(result.outputFiles[0].contents).length;
  console.log(`${label}: ${(bytes / 1024).toFixed(1)} KB gzip`);
  return bytes;
}
const primitives = await size(`export * from '@assistant-ui/react';`, 'assistant-ui/react (всё)');
const used = await size(`export { AssistantRuntimeProvider, useExternalStoreRuntime, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';`, 'assistant-ui/react (используемое)');
const streamdown = await size(`export { Streamdown } from 'streamdown';`, 'streamdown');
const aiSdk = await size(`export * from '@assistant-ui/ai-sdk';`, '@assistant-ui/ai-sdk');
console.log(JSON.stringify({ primitives, used, streamdown, aiSdk, limit: 80 * 1024, usedWithinLimit: used <= 80 * 1024, usedPlusStreamdownWithinLimit: used + streamdown <= 80 * 1024 }));
