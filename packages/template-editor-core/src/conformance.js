import { contentsEqual } from './contents-equal.js';
import { validateDialectDescriptor } from './dialect.js';
import { EditorError } from './errors.js';

const assert = (condition, message) => { if (!condition) throw new Error(`Host contract: ${message}`); };
async function rejects(operation, code, label) {
  try { await operation(); }
  catch (error) { assert(error instanceof EditorError && error.code === code, `${label} must reject with ${code}, got ${error?.name}/${error?.code}`); return; }
  throw new Error(`Host contract: ${label} must reject with ${code}`);
}
function sameFiles(expected, actual, label) {
  assert(Object.keys(expected).length === Object.keys(actual).length, `${label}: file count changed`);
  for (const [path, value] of Object.entries(expected)) assert(Object.hasOwn(actual, path) && typeof value === typeof actual[path] && contentsEqual(value, actual[path]), `${label}: ${path} changed`);
}

/** Run only with a fresh, disposable test project: this suite intentionally saves. */
export async function runHostConformance(hostFactory, { knownIds, faults = {} }) {
  const host = await hostFactory(), checks = [];
  try {
    assert(validateDialectDescriptor(host.dialect, knownIds), 'invalid dialect descriptor');
    assert(typeof host.language === 'string' && host.messages && typeof host.messages === 'object', 'language and messages are required');
    const capabilities = JSON.stringify(host.capabilities);
    for (const name of ['inlinePreview', 'preview', 'lifecycle', 'ai', 'locales', 'entrypoint', 'autosave', 'sourceExport', 'htmlExport']) assert(typeof host.capabilities[name] === 'boolean', `${name} capability must be boolean`);
    for (const name of ['preview', 'lifecycle', 'ai']) assert(host.capabilities[name] ? Boolean(host[name]) : !Object.hasOwn(host, name), `${name} port must match its capability (absent means no key)`);
    for (const [name, methods] of Object.entries({ project: ['open', 'save', 'import', 'export'], analyzer: ['analyze', 'render'], preview: ['create', 'revoke', 'history'], lifecycle: ['run'], ai: ['begin', 'finish'] })) {
      if (!host[name]) { assert(!['project', 'analyzer'].includes(name), `${name} is required`); continue; }
      for (const method of methods) assert(typeof host[name][method] === 'function', `${name}.${method} is required`);
    }
    if (host.ai) {
      const settings = host.ai.settings;
      assert(['host', 'user'].includes(settings?.owner), 'AI settings owner must be declared');
      for (const key of ['load', 'test']) assert(typeof settings[key] === 'function', `AI settings.${key} is required`);
      for (const key of ['save', 'remove']) assert(settings.owner === 'user' ? typeof settings[key] === 'function' : !Object.hasOwn(settings, key), `AI ${settings.owner} settings ${key} contract`);
    }
    checks.push('shape', 'dialect', 'capabilities');
    const original = await host.project.open();
    const draft = { ...original, files: { ...original.files, 'conformance.txt': '\n  exact é 😀\r\n\t', 'conformance.bin': new Uint8Array([0, 255, 1, 128, 13, 10]) } };
    const saved = await host.project.save(draft);
    assert(saved.revision !== original.revision, 'save must advance the optimistic revision');
    sameFiles(draft.files, saved.files, 'save');
    sameFiles(saved.files, (await host.project.open()).files, 'open');
    await rejects(() => host.project.save(draft), 'conflict', 'stale save');
    checks.push('text/binary save', 'concurrency');
    if (host.capabilities.sourceExport) {
      const archive = await host.project.export(saved, { locale: saved.locale, format: 'source' });
      assert(archive.bytes instanceof Uint8Array && typeof archive.name === 'string' && typeof archive.mime === 'string', 'export must return a named binary download');
      sameFiles(saved.files, (await host.project.import(archive.bytes)).files, 'ZIP round trip');
      checks.push('text/binary import/export');
    }
    const controller = new AbortController(); controller.abort();
    await rejects(() => host.analyzer.analyze(saved, { signal: controller.signal }), 'abort', 'analysis cancellation');
    await rejects(() => host.analyzer.render(saved, { locale: saved.locale, signal: controller.signal }), 'abort', 'render cancellation');
    await rejects(() => host.project.save(saved, { signal: controller.signal }), 'abort', 'save cancellation');
    // Abort between request dispatch and resolution; synchronous hosts still check after await.
    const pending = new AbortController();
    const analysis = host.analyzer.analyze(saved, { signal: pending.signal }); pending.abort();
    await rejects(() => analysis, 'abort', 'in-flight analysis cancellation');
    checks.push('cancellation');
    for (const [code, operation] of Object.entries(faults)) await rejects(() => operation(host), code, `${code} fault`);
    if (Object.keys(faults).length) checks.push('injected adapter failures');
    assert(JSON.stringify(host.capabilities) === capabilities, 'capabilities changed during the session');
    return { checks };
  } finally { await host.dispose?.(); }
}
