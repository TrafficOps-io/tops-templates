import { translateStudio } from '@trafficops/template-editor-shell/translation';
// @ts-check
import { decodeProject, encodeProject, PolicyError, ConflictError, runOperation, throwIfAborted } from '@trafficops/template-editor-core';

/** @typedef {import('@trafficops/template-editor-core').EditorHost} EditorHost */
const interpolate = (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);

/** The HTTP wire format remains private to this adapter. */
/** @returns {import('@trafficops/template-editor-core').HistoryGroup[]} */
export function projectHistory(payload, t) {
  /** @returns {import('@trafficops/template-editor-core').HistoryAction[]} */
  const rowActions = (group, id, operations) => operations.map(([operation, label, format]) => ({ id: operation, label: t(label), operation: operation === 'restore' ? 'lifecycle' : operation, target: { group, id: String(id) }, ...(format ? { format } : {}) }));
  const drafts = { id: 'drafts', label: t('Drafts'), count: payload.draftHistory?.length || 0,
    empty: { title: t('No saved drafts yet'), description: t('Drafts appear after you save, and let you recover deleted fields or files.') },
    rows: (payload.draftHistory || []).map(item => ({ id: String(item.revision), title: t('Draft {number}', { number: item.revision }), meta: [item.created_at], actions: rowActions('drafts', item.revision, [['export', 'Download source ZIP', 'source']]) })) };
  if (payload.kind === 'template') return [{ id: 'versions', label: t('Versions'), count: payload.versions?.length || 0,
    empty: { title: t('No template versions yet'), description: t('Create a version to make this template available for new pages.') },
    rows: (payload.versions || []).map(item => ({ id: item.id, title: t('Version {number}', { number: item.number }), meta: [item.createdAt], actions: [{ id: 'export', label: t('Download source ZIP'), operation: 'export', target: { group: 'versions', id: item.id }, format: 'source' }] })) }, drafts];
  return [{ id: 'publications', label: t('Publications'), count: payload.revisions?.length || 0,
    empty: { title: t('This page has not been published yet'), description: t('Published versions appear here. You can preview, download and restore them.') },
    rows: (payload.revisions || []).map(item => ({ id: item.id, title: t('Publication {number}', { number: item.number }), ...(item.current ? { badge: t('Current') } : {}),
      meta: [item.createdAt, item.author, ...(item.locales || [])].filter(Boolean), actions: rowActions('publications', item.id, [['preview', 'Preview'], ['export', 'Download HTML ZIP', 'html'], ...(!item.current ? [['restore', 'Restore']] : [])]) })) }, drafts];
}

/** @param {{endpoint:string, csrf:string, language?:string, messages?:Record<string,string>, fetchImpl?:typeof fetch, signal?:AbortSignal, aiEndpoint?:string, aiSettingsUrl?:string, initialAiRequest?:{id:string, prompt:string, mode?:'create'|'edit', autoStart:boolean}}} options
 * @returns {Promise<EditorHost>} */
export async function createHttpHost(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const t = (text, values) => interpolate(options.messages?.[text] ?? translateStudio(text, options.language), values);
  const headers = { Accept: 'application/json', 'X-CSRF-TOKEN': options.csrf, 'Content-Type': 'application/json' };
  /** @param {string} url @param {{data?:unknown, method?:string, signal?:AbortSignal, form?:FormData}} options */
  async function request(url, { data, method = 'POST', signal, form } = {}) {
    return runOperation(signal, async () => {
      const response = await fetchImpl(url, { method, credentials: 'same-origin', signal,
        headers: form ? { Accept: headers.Accept, 'X-CSRF-TOKEN': options.csrf } : headers,
        ...(form ? { body: form } : data !== undefined ? { body: JSON.stringify(data) } : {}) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw Object.assign(new Error(payload.message || payload.error?.message || Object.values(payload.errors || {}).flat().join(' ') || t('The request failed. Try again.')), { payload, status: response.status });
      }
      return response;
    });
  }
  /** @param {string} action @param {unknown} data @param {{signal?:AbortSignal, method?:string}} options */
  async function json(action = '', data, { signal, method = 'POST' } = {}) {
    const response = await request(options.endpoint + (action ? `/${action}` : ''), { data, signal, method });
    return runOperation(signal, () => response.json());
  }
  const initial = await json('', undefined, { method: 'GET', signal: options.signal });
  let metadata = initial, run = null, starting = null;
  const capabilities = Object.freeze({ inlinePreview: true, preview: true, lifecycle: true, ai: Boolean(initial.aiEnabled), locales: true, entrypoint: true, autosave: false, sourceExport: true, htmlExport: true });
  const analysis = payload => ({ definition: payload.definition || null, pages: payload.pages || [], entrypoint: payload.entrypoint || null,
    diagnostics: payload.diagnostics || [], sourceDiagnostics: payload.sourceDiagnostics || [], previewAvailable: !(payload.sourceDiagnostics?.length) && Boolean(payload.pages?.length) });
  /** @returns {import('@trafficops/template-editor-core').ProjectState} */
  function unpack(payload) {
    metadata = payload;
    const versionNumber = payload.versionNumber ?? payload.versions?.[0]?.number;
    const publishedNumber = payload.publishedNumber ?? payload.revisions?.find(item => item.current)?.number;
    const status = payload.kind === 'template'
      ? !versionNumber ? t('Template draft') : payload.hasUnreleasedChanges ? t('Version {number} · draft changes', { number: versionNumber }) : t('Version {number} ready', { number: versionNumber })
      : payload.status !== 'published' ? t('Page draft') : payload.hasUnreleasedChanges ? t('Publication {number} · draft changes', { number: publishedNumber }) : publishedNumber ? t('Publication {number} is live', { number: publishedNumber }) : t('Published');
    /** @type {import('@trafficops/template-editor-core').ActionDescriptor[]} */
    const actions = payload.kind === 'template' ? [{ id: 'version', label: t('Create version'), intent: 'primary' }]
      : [{ id: 'publish', label: t(payload.status === 'published' ? 'Publish changes' : 'Publish'), intent: 'primary' }];
    if (payload.kind === 'page' && payload.canSaveTemplate) actions.push({ id: 'save-template', label: t('Save as team template'), intent: 'secondary',
      input: { label: t('Template name'), value: payload.name, maxLength: 120, help: t('Saves your current work as a reusable team template. Existing pages keep their own copies.') } });
    if (payload.kind !== 'template' && payload.status === 'published') actions.push({ id: 'unpublish', label: t('Unpublish'), intent: 'danger' });
    return { name: payload.name, revision: payload.revision, files: decodeProject(payload.files), folders: payload.folders || [], entrypoint: payload.entrypoint || null,
      locale: payload.locale, translations: payload.translations, status,
      availability: { inlinePreview: true, externalPreview: Boolean(payload.previewEnabled), ai: Boolean(payload.aiEnabled) }, actions, history: projectHistory(payload, t), analysis: analysis(payload) };
  }
  const wire = (state, locale = state.locale) => ({ name: state.name, revision: state.revision, files: encodeProject(state.files), folders: state.folders,
    entrypoint: state.entrypoint, locale: state.locale, translations: state.translations, editingLocale: locale });
  /** @type {import('@trafficops/template-editor-core').ProjectPort} */
  const project = {
    async open({ signal } = {}) { return unpack(await json('', undefined, { signal, method: 'GET' })); },
    async save(state, { signal } = {}) { return unpack(await json('save', wire(state), { signal })); },
    async import(bytes, { signal } = {}) {
      const form = new FormData(); form.append('archive', new Blob([new Uint8Array(bytes)]), 'project.zip');
      const response = await request(`${options.endpoint}/import`, { form, signal });
      return runOperation(signal, async () => { const payload = await response.json(); return { files: decodeProject(payload.files), folders: payload.folders || [], settings: payload.values || {}, entrypoint: payload.entrypoint || null }; });
    },
    async export(state, { signal, format, locale, continueUrl, history }) {
      let response;
      if (history?.group === 'versions') {
        const version = metadata.versions?.find(item => item.id === history.id);
        if (!version) throw new PolicyError(t('This version is unavailable.'));
        response = await request(version.downloadUrl, { method: 'GET', signal });
      } else {
        const action = history?.group === 'drafts' ? 'draft-download' : history ? 'history-download' : 'download';
        response = await request(`${options.endpoint}/${action}`, { signal, data: { ...wire(state, locale), format, continueUrl,
          ...(history?.group === 'drafts' ? { draftRevision: Number(history.id) } : history ? { revisionId: history.id } : {}) } });
      }
      return runOperation(signal, async () => ({ name: `${state.name}-${locale}-${format}.zip`, mime: 'application/zip', bytes: new Uint8Array(await response.arrayBuffer()) }));
    },
  };
  /** @type {import('@trafficops/template-editor-core').AnalyzerPort} */
  const analyzer = {
    async analyze(state, { signal } = {}) { return analysis(await json('validate', wire(state), { signal })); },
    async render(state, { signal, locale }) { return decodeProject((await json('render', wire(state, locale), { signal })).files); },
  };
  /** @type {import('@trafficops/template-editor-core').PreviewPort} */
  const preview = {
    create(state, { signal, locale, shared = true }) { return json('preview', { ...wire(state, locale), shared }, { signal }); },
    async revoke(value, { signal } = {}) { await json('revoke', { previewId: value.id }, { signal }); },
    history(target, { signal, locale }) { return json('history-preview', { revisionId: target.id, editingLocale: locale }, { signal }); },
  };
  /** @type {import('@trafficops/template-editor-core').LifecyclePort} */
  const lifecycle = {
    async run(action, state, { signal, locale, target, inputValue }) {
      if (!['version', 'publish', 'unpublish', 'restore', 'save-template'].includes(action)) throw new PolicyError(t('This action is unavailable.'));
      const payload = await json(action, { ...wire(state, locale), ...(target ? { revisionId: target.id } : {}), ...(action === 'save-template' ? { templateName: inputValue } : {}) }, { signal });
      const next = unpack(payload), persisted = ['version', 'publish', 'save-template'].includes(action);
      return { state: persisted ? next : { ...state, revision: next.revision, status: next.status, actions: next.actions, history: next.history }, persisted,
        notice: payload.notice || t(action === 'publish' ? 'Published.' : action === 'version' ? 'Version created.' : action === 'restore' ? 'Publication restored.' : 'Unpublished.') };
    },
  };
  /** @param {string} action @param {unknown} data @param {{signal?:AbortSignal, method?:string}} options */
  const aiRequest = async (action, data, { signal, method = 'POST' } = {}) => {
    const response = await request(`${options.aiEndpoint}/${action}`, { data, signal, method });
    return runOperation(signal, () => response.json());
  };
  /** @type {import('@trafficops/template-editor-core').HostAiSettings} */
  const settings = {
    owner: 'host', ...(options.aiSettingsUrl ? { url: options.aiSettingsUrl } : {}),
    async load({ signal } = {}) { return aiRequest('settings', undefined, { signal, method: 'GET' }); },
    async test({ signal } = {}) { await aiRequest('check', {}, { signal }); return { message: t('Connection works.') }; },
  };
  async function finish() { const ended = run; run = null; if (ended) await aiRequest('finish', { run: ended }); }
  /** @type {import('@trafficops/template-editor-core').AiPort} */
  const ai = {
    settings,
    ...(options.initialAiRequest ? { initialRequest: { ...options.initialAiRequest, mode: options.initialAiRequest.mode || 'create',
      async claim({ signal } = {}) { return (await json('ai-kickoff', { requestId: options.initialAiRequest.id, revision: metadata.revision }, { signal })).started === true; },
    } } : {}),
    async begin({ signal } = {}) {
      if (run || starting) throw new ConflictError(t('An AI request is already running.'));
      const token = {}; starting = token;
      try {
      const connection = await settings.load({ signal });
      if (!connection.configured) throw new PolicyError(t('No key configured. Ask your administrator.'));
      const session = await aiRequest('start', {}, { signal });
      run = session.run;
      return { ...connection, timeoutMs: session.timeoutMs, apiKey: 'host-managed', fetchImpl: async (url, init = {}) => {
        const path = new URL(String(url)).pathname;
        if (!['/api/v1/chat/completions', '/api/v1/images'].includes(path)) throw new PolicyError('Unsupported AI operation');
        throwIfAborted(init.signal || undefined);
        return request(`${options.aiEndpoint}/${path.endsWith('/images') ? 'image' : 'chat'}`, { data: { ...JSON.parse(String(init.body)), run }, signal: init.signal || undefined });
      } };
      } catch (error) { if (run) await finish().catch(() => {}); throw error; }
      finally { if (starting === token) starting = null; }
    },
    finish,
  };
  return { language: options.language || 'en', messages: options.messages || {}, capabilities, dialect: initial.dialect,
    project, analyzer, preview, lifecycle, ...(capabilities.ai ? { ai } : {}), async dispose() { if (run) await finish().catch(() => {}); } };
}
