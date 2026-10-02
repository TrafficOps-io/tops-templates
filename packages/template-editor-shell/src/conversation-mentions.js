export function mentionAtCaret(value, caret = value.length) {
  const before = value.slice(0, caret), match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

export function matchingMentionPaths(files, query = '') {
  const normalized = query.toLocaleLowerCase();
  return Object.keys(files || {}).filter(path => path.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => a.localeCompare(b)).slice(0, 20);
}

export function addFileMention(mentions, path) {
  return mentions.some(item => item?.kind !== 'section' && (typeof item === 'string' ? item : item.path) === path)
    ? mentions : [...mentions, { path }];
}

export function mentionKey(item) {
  return item?.kind === 'section' ? JSON.stringify(['section', item.page, item.id, item.locale]) : JSON.stringify(['file', typeof item === 'string' ? item : item.path]);
}

export function mentionLabel(item) { return item?.kind === 'section' ? item.label || item.id : typeof item === 'string' ? item : item.path; }

export function addSectionMention(mentions, section) {
  const item = { kind: 'section', id: section.id, page: section.page, label: section.label,
    ...(section.path ? { path: section.path } : {}), ...(section.locale ? { locale: section.locale } : {}) };
  return mentions.some(value => mentionKey(value) === mentionKey(item)) ? mentions : [...mentions, item];
}

export function matchingMentions(files, sections = [], query = '', kind) {
  const normalized = query.toLocaleLowerCase();
  const paths = kind === 'section' ? [] : matchingMentionPaths(files, query).map(path => ({ kind: 'file', path }));
  const blocks = kind === 'file' ? [] : sections.filter(section => [section.label, section.description, section.page, section.path, section.id].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized));
  return [...blocks.slice(0, 20), ...paths];
}
