// Recover only JSON objects whose closing brace actually arrived. Partial-JSON
// repair is useful for display, but must never manufacture saved file bytes.
export function completedFileInput(kind, text) {
  const file = value => value && typeof value.path === 'string' && typeof value.content === 'string'
    && Object.keys(value).every(key => key === 'path' || key === 'content');
  if (kind === 'set_file') {
    try { const value = JSON.parse(text); return file(value) ? [value] : []; } catch { return []; }
  }
  if (kind !== 'set_files') return [];
  const prefix = /^\s*\{\s*"files"\s*:\s*\[/.exec(text);
  if (!prefix) return [];
  const files = [];
  let offset = prefix[0].length;
  while (files.length < 20) {
    while (/\s/.test(text[offset] || '') && offset < text.length) offset++;
    if (text[offset] !== '{') break;
    const start = offset;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (; offset < text.length; offset++) {
      const char = text[offset];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if ((char === '}' || char === ']') && --depth === 0) { end = ++offset; break; }
    }
    if (end < 0) break;
    try {
      const value = JSON.parse(text.slice(start, end));
      if (!file(value)) break;
      files.push(value);
    } catch { break; }
    while (/\s/.test(text[offset] || '') && offset < text.length) offset++;
    if (text[offset++] !== ',') break;
  }
  return files;
}
