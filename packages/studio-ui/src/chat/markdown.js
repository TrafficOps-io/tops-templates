// Lightweight markdown parser for chat replies. Streamdown was rejected by the spike (bundle size), see
// ads-toolbox docs/superpowers/plans/2026-10-01-studio-ui-spike-result.md. Markdown.jsx renders the tree as
// React elements; no HTML is ever inserted, so raw HTML in a reply stays visible text.
//
// Blocks:  { type: 'paragraph', children } | { type: 'heading', level: 1-3, children }
//          | { type: 'list', ordered, start, items: inline[][] } | { type: 'code', lang, text }
// Inline:  { type: 'text', text } | { type: 'strong', children } | { type: 'em', children }
//          | { type: 'code', text } | { type: 'break' }
// Supported: paragraphs, # headings, **bold**, *italic*, `code`, "-"/"*" and "1." lists, ``` fences.
// An unterminated fence (streaming) runs to the end of the text; unmatched markers stay literal.

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,3})\s+(.*?)\s*#*\s*$/;

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseLines(paragraph) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body = [];
      index++;
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index++; // closing fence (or past the end)
      blocks.push({ type: 'code', lang: fence[1] || '', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); index++; continue; }
    const heading = line.match(HEADING);
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) }); index++; continue; }
    const bullet = line.match(BULLET), ordered = line.match(ORDERED);
    if (bullet || ordered) {
      flush();
      const isOrdered = Boolean(ordered && !bullet), pattern = isOrdered ? ORDERED : BULLET;
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (match) { items.push([isOrdered ? match[2] : match[1]]); index++; continue; }
        // an indented non-empty line continues the previous item
        if (items.length && /^\s{2,}\S/.test(lines[index]) && !FENCE.test(lines[index])) { items.at(-1).push(lines[index].trim()); index++; continue; }
        break;
      }
      blocks.push({ type: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: items.map(parseLines) });
      continue;
    }
    paragraph.push(line);
    index++;
  }
  flush();
  return blocks;
}

// Lines of one paragraph or list item: single newlines become line breaks.
function parseLines(lines) {
  return lines.flatMap((line, index) => index ? [{ type: 'break' }, ...parseInline(line.trim())] : parseInline(line.trim()));
}

export function parseInline(text) {
  const nodes = [];
  let plain = '';
  const push = node => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } nodes.push(node); };
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    if (rest[0] === '`') {
      const close = text.indexOf('`', index + 1);
      if (close > index + 1) { push({ type: 'code', text: text.slice(index + 1, close) }); index = close + 1; continue; }
    }
    if (rest.startsWith('**')) {
      const close = findClose(text, '**', index + 2);
      if (close > 0) { push({ type: 'strong', children: parseInline(text.slice(index + 2, close)) }); index = close + 2; continue; }
    }
    if (rest[0] === '*' && rest[1] !== '*') {
      const close = findClose(text, '*', index + 1);
      if (close > 0) { push({ type: 'em', children: parseInline(text.slice(index + 1, close)) }); index = close + 1; continue; }
    }
    plain += rest[0];
    index++;
  }
  if (plain) nodes.push({ type: 'text', text: plain });
  return nodes;
}

// Closing marker: content must be non-empty and not start or end with whitespace; a single "*" does not
// close on part of "**", and inline code spans are skipped.
function findClose(text, marker, from) {
  if (from >= text.length || /\s/.test(text[from])) return -1;
  for (let index = from; index < text.length; index++) {
    if (text[index] === '`') { const close = text.indexOf('`', index + 1); if (close > index) { index = close; continue; } }
    if (!text.startsWith(marker, index) || index === from || /\s/.test(text[index - 1])) continue;
    if (marker === '*') {
      if (text[index + 1] === '*') { index++; continue; }
      if (text[index - 1] === '*') continue;
    }
    return index;
  }
  return -1;
}
