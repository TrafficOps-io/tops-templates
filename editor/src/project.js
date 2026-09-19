export * from '@trafficops/template-editor-core/project';

export function languageFor(path) {
  if (/\.tpl(?:\.html)?$/i.test(path)) return 'trafficops-tpl';
  if (/\.html?$/i.test(path)) return 'html';
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ css: 'css', js: 'javascript', mjs: 'javascript', json: 'json', md: 'markdown', svg: 'xml', xml: 'xml', yaml: 'yaml', yml: 'yaml' })[extension] || 'plaintext';
}

export function downloadFile(name, value, mime = 'application/zip') {
  const url = URL.createObjectURL(new Blob([value], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
