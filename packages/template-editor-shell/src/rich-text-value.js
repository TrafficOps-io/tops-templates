const escape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Recover legacy plain values and JSON-style attribute quotes without touching
// authored text inside HTML. Stored rich text remains HTML, never preview URLs.
export function prepareWysiwygValue(value) {
  let source = String(value ?? '');
  if (!source.trim()) return source;
  if (source.startsWith('"') && source.endsWith('"')) {
    try { const decoded = JSON.parse(source); if (typeof decoded === 'string' && /<[a-z][\s\S]*>/i.test(decoded)) source = decoded; } catch { /* Ordinary quoted text is still text. */ }
  }
  if (/<(?:[a-z][a-z\d:-]*[\s/>]|\/[a-z]|!|\?)/i.test(source)) {
    return source.replace(/<[^>]*>/g, tag => tag.replace(/\\"/g, '"'));
  }
  return source.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/).map(paragraph => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

export function isEditorImageSource(source, projectImages = []) {
  if (projectImages.includes(source)) return true;
  try { const url = new URL(source); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

export function prepareRichTextValues(fields, values) {
  let result = values;
  for (const field of fields) {
    const value = values?.[field.name]; let next = value;
    if (field.type === 'wysiwyg' && typeof value === 'string') next = prepareWysiwygValue(value);
    else if (field.type === 'group' && value && typeof value === 'object' && !Array.isArray(value)) next = prepareRichTextValues(field.fields || [], value);
    else if (field.type === 'repeater' && Array.isArray(value)) {
      const rows = value.map(row => row && typeof row === 'object' && !Array.isArray(row) ? prepareRichTextValues(field.fields || [], row) : row);
      if (rows.some((row, index) => row !== value[index])) next = rows;
    }
    if (next !== value) { if (result === values) result = { ...values }; result[field.name] = next; }
  }
  return result;
}
