'use strict';

// Standalone and explicit plugins keep formatting independent of workspace code,
// Prettier installations, configuration files and executable project plugins.
const prettier = require('prettier/standalone');
const htmlPlugin = require('prettier/plugins/html');
const cssPlugin = require('prettier/plugins/postcss');
const babelPlugin = require('prettier/plugins/babel');
const estreePlugin = require('prettier/plugins/estree');
const { phpSpans } = require('./language');
const plugins = [htmlPlugin, cssPlugin, babelPlugin, estreePlugin];

const pairs = new Map([
  ['type', 'endtype'], ['section', 'endsection'], ['block', 'endblock'],
  ['layout', 'endlayout'], ['if', 'endif'], ['unless', 'endunless'], ['each', 'endeach'], ['validation', 'endvalidation'],
]);
const endings = new Set(pairs.values());
const markupDirectives = new Set(['if', 'endif', 'unless', 'endunless', 'each', 'endeach', 'render', 'include']);
// Literal CSS at-rules accepted by TemplateMarkupCompiler::nodes. Other CSS
// at-rules must keep the DSL's leading @@ escape if moved onto their own line.
const cssDirectives = new Set(['media', 'supports', 'font-face', 'keyframes', 'import', 'layer',
  'container', 'charset', 'page', 'property', 'starting-style', 'namespace', 'scope', 'counter-style']);

/**
 * Every replacement belongs to this invocation, and the prefix cannot occur in
 * the source. Restore in reverse order: an embedded-language replacement can
 * itself contain protected strings and interpolations.
 */
class Placeholders {
  constructor(source) {
    this.prefix = 'tplfmtx';
    while (source.includes(this.prefix)) this.prefix += 'x';
    this.entries = [];
    this.index = 0;
  }

  name() { return `${this.prefix}${this.index++}z`; }

  add(value, makeKey = name => name, mode = 'exact') {
    const key = makeKey(this.name());
    this.entries.push({ key, value, mode });
    return key;
  }

  restore(source) {
    for (const { key, value, mode } of [...this.entries].reverse()) {
      if (mode === 'line') {
        source = source.replace(new RegExp(`^[\\t ]*${escapeRegExp(key)}[\\t ]*\\n?`, 'gm'), '');
      } else if (mode === 'indent') {
        source = source.replace(new RegExp(`^([\\t ]*)${escapeRegExp(key)}`, 'gm'), (_, indent) =>
          value.split('\n').map((line, index) => index === 0 ? indent + line : (line ? indent + line : '')).join('\n'));
      } else if (mode === 'at') {
        // HTML wrapping must not turn inline text such as @reader into a DSL
        // directive. Keep its first character on the preceding physical line.
        source = source.replace(new RegExp(`\\n[\\t ]*(?=${escapeRegExp(key)})`, 'g'), ' ');
        source = source.split(key).join(value);
      } else if (mode === 'body') {
        // The HTML printer may add a newline around raw script content even
        // with embedded formatting disabled. Restore the complete body span.
        source = source.replace(new RegExp(`>\\s*${escapeRegExp(key)}\\s*</`, 'g'), () => '>' + value + '</');
      } else {
        source = source.split(key).join(value);
      }
    }
    return source.includes(this.prefix) ? null : source;
  }
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function interpolations(source, placeholders) {
  return source.replace(/\{\{\{[^{}\n]*\}\}\}|\{\{[^{}\n]*\}\}|(?<!\{)\{(?:(?:query|headers|body|actions)\.(?:\*|[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)|locale)\}(?!\})/g, value => placeholders.add(value));
}

function protectComments(source, placeholders) {
  // Comment contents can resemble HTML, declarations or runtime expressions.
  // Keep them opaque to both the DSL masker and the HTML printer. Raw-element
  // processing runs first so prettier-ignore still protects its target body.
  return source.replace(/<!--[\s\S]*?(?:-->|$)/g, value => placeholders.add(value, name => `<!--${name}-->`));
}

function directive(line) {
  const match = line.match(/^\s*@([A-Za-z][A-Za-z0-9_-]*)\b(.*)$/);
  return match && { name: match[1], text: line.trim(), arguments: match[2].trim() };
}

function protectJavaScriptLiterals(source, placeholders) {
  const ast = babelPlugin.parsers.babel.parse(source, { sourceType: 'unambiguous' });
  const literals = [];
  const visited = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (['StringLiteral', 'DirectiveLiteral', 'TemplateLiteral'].includes(node.type)) {
      literals.push(node);
      return; // Preserve an entire template literal, including its expressions.
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  for (const literal of literals.sort((a, b) => b.start - a.start)) {
    const quote = literal.type === 'TemplateLiteral' ? '`' : '"';
    const token = placeholders.add(source.slice(literal.start, literal.end), name => quote + name + quote);
    source = source.slice(0, literal.start) + token + source.slice(literal.end);
  }
  return source;
}

async function embedded(source, parser, placeholders, options) {
  const firstEntry = placeholders.entries.length;
  try {
    let masked = interpolations(source, placeholders);
    const directives = new Map();
    const escapedCss = new Set();
    masked = masked.split('\n').map(line => {
      if (parser === 'css' && /^[\t ]*@@/.test(line)) {
        const marker = `/*${placeholders.name()}*/`;
        escapedCss.add(marker);
        return marker + '\n' + line.replace(/^([\t ]*)@@/, '$1@');
      }
      const parsed = directive(line);
      if (!parsed || !markupDirectives.has(parsed.name)) return line;
      const marker = `/*${placeholders.name()}*/`;
      directives.set(marker, parsed);
      return marker;
    }).join('\n');
    if (parser === 'babel') {
      masked = protectJavaScriptLiterals(masked, placeholders);
      // An own-line DSL directive inside a JS literal needs the runtime's
      // context-sensitive expansion. Preserve this fragment verbatim.
      for (const entry of placeholders.entries.slice(firstEntry)) {
        for (const marker of directives.keys()) if (entry.value.includes(marker)) throw new Error('Directive inside literal');
      }
    }
    let formatted = (await prettier.format(masked, {
      ...options, parser, quoteProps: 'preserve', embeddedLanguageFormatting: 'off',
    })).trimEnd();
    if (directives.size) {
      let depth = 0;
      formatted = formatted.split('\n').map(line => {
        const parsed = directives.get(line.trim());
        if (parsed && endings.has(parsed.name)) depth = Math.max(0, depth - 1);
        const result = options.indent.repeat(depth) + (parsed ? line.replace(line.trim(), parsed.text) : line);
        if (parsed && pairs.has(parsed.name)) depth++;
        return result;
      }).join('\n');
      // If a formatter absorbed a directive into an expression, retain the
      // original fragment rather than emitting a directive on the wrong line.
      for (const marker of directives.keys()) if (formatted.includes(marker)) throw new Error('Inline directive');
    }
    for (const marker of escapedCss) {
      const matcher = new RegExp(`${escapeRegExp(marker)}\\s*@`, 'g');
      formatted = formatted.replace(matcher, '@@');
      if (formatted.includes(marker)) throw new Error('Unrestored CSS escape');
    }
    if (parser === 'css') {
      const retainedDirectives = new Set([...directives.values()].map(parsed => parsed.text));
      formatted = formatted.split('\n').map(line => {
        const parsed = directive(line);
        if (!parsed || cssDirectives.has(parsed.name) || retainedDirectives.has(parsed.text)) return line;
        return line.replace(/^([\t ]*)@/, '$1@@');
      }).join('\n');
    }
    return formatted;
  } catch {
    placeholders.entries.splice(firstEntry);
    return null;
  }
}

function attributeValue(tag, name) {
  const attributes = tag.replace(/^<[A-Za-z][A-Za-z0-9:-]*/, '').replace(/\/?>$/, '');
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(attributes))) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? '';
  }
  return '';
}

function scriptParser(tag) {
  const value = attributeValue(tag, 'type').trim().toLowerCase();
  if (!value || ['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(value)) return 'babel';
  return null;
}

const htmlTags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[A-Za-z][A-Za-z0-9:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;

function closingElement(source, name, offset, nested) {
  if (!nested) {
    const closing = new RegExp(`</${name}\\s*>`, 'gi');
    closing.lastIndex = offset;
    return closing.exec(source);
  }
  const tags = new RegExp(htmlTags);
  tags.lastIndex = offset;
  let depth = 1;
  let tag;
  while ((tag = tags.exec(source))) {
    const parsed = tag[0].match(/^<(\/)?([A-Za-z][A-Za-z0-9:-]*)\b/);
    if (!parsed) continue;
    const current = parsed[2].toLowerCase();
    if (current === name) {
      depth += parsed[1] ? -1 : 1;
      if (!depth) return tag;
    } else if (!parsed[1] && ['script', 'style', 'textarea'].includes(current)) {
      const end = closingElement(source, current, tags.lastIndex, false);
      if (end) tags.lastIndex = end.index + end[0].length;
    }
  }
  return null;
}

function hasSignificantWhitespace(tag) {
  const value = attributeValue(tag, 'style');
  return value && /(?:^|;)\s*white-space\s*:\s*(?:pre(?:-wrap|-line)?|break-spaces)\b/i.test(value);
}

async function protectRawElements(source, placeholders, options) {
  // HTML itself treats script/style/textarea bodies as raw text. Quoted > in
  // attributes must not end an opening tag early.
  const opening = new RegExp(htmlTags);
  let result = '';
  let offset = 0;
  let match;
  while ((match = opening.exec(source))) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    // Defaults and labels are DSL strings, even if they contain complete HTML.
    // The runtime reserves every own-line @directive before parsing markup.
    if (/^[\t ]*@/.test(source.slice(lineStart, match.index))) continue;
    const tag = match[0].match(/^<([A-Za-z][A-Za-z0-9:-]*)\b/);
    if (!tag) continue;
    const name = tag[1].toLowerCase();
    const raw = ['script', 'style', 'pre', 'textarea', 'xmp', 'listing'].includes(name);
    const ignored = /<!--\s*prettier-ignore\s*-->\s*$/.test(source.slice(0, match.index));
    if (!raw && !ignored && !hasSignificantWhitespace(match[0])) continue;
    const end = closingElement(source, name, opening.lastIndex, !raw);
    if (!end) continue;
    const body = source.slice(opening.lastIndex, end.index);
    const parser = name === 'style' ? 'css' : name === 'script' ? scriptParser(match[0]) : null;
    const formatted = parser && !ignored ? await embedded(body, parser, placeholders, options) : null;
    let replacement;
    if (formatted !== null && formatted !== '') {
      const indent = source.slice(lineStart, match.index).match(/^[\t ]*/)[0];
      replacement = '\n' + indent + options.indent + placeholders.add(formatted, undefined, 'indent') + '\n' + indent;
    } else {
      replacement = placeholders.add(body, undefined, 'body');
    }
    result += source.slice(offset, opening.lastIndex) + replacement + end[0];
    offset = end.index + end[0].length;
    opening.lastIndex = offset;
  }
  return result + source.slice(offset);
}

const blockElements = new Set(['html', 'head', 'body', 'address', 'article', 'aside', 'blockquote',
  'details', 'dialog', 'div', 'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul']);

function breakBlockElements(source) {
  // Prettier keeps a compact <section><h1>Title</h1></section> on one line.
  // Seed breaks between known block elements while retaining inline adjacency.
  const tags = new RegExp(htmlTags);
  let previous = null;
  let offset = 0;
  let result = '';
  let match;
  while ((match = tags.exec(source))) {
    const parsed = match[0].match(/^<(\/)?([A-Za-z][A-Za-z0-9:-]*)\b/);
    const current = parsed && { closing: !!parsed[1], name: parsed[2].toLowerCase(), end: tags.lastIndex };
    const gap = previous && source.slice(previous.end, match.index);
    if (previous && current && /^[\t ]*$/.test(gap) &&
      blockElements.has(previous.name) && blockElements.has(current.name) &&
      (previous.closing || !current.closing)) {
      result += source.slice(offset, previous.end) + '\n';
      offset = match.index;
    }
    previous = current;
  }
  return result + source.slice(offset);
}

function maskDirectives(source, placeholders) {
  const stack = [];
  const sentinel = placeholders.add('', name => `<!--${name}-->`, 'line');
  let result = source.split('\n').map(line => {
    const parsed = directive(line);
    if (!parsed) {
      if (/^\s*@@/.test(line)) return placeholders.add(line.trim(), name => `<!--${name}-->`);
      return line.replace(/@/g, () => placeholders.add('@', undefined, 'at'));
    }
    if (pairs.has(parsed.name)) {
      const name = placeholders.name();
      const open = `<${name}>`;
      placeholders.entries.push({ key: open, value: parsed.text, mode: 'exact' });
      stack.push({ name, end: pairs.get(parsed.name) });
      return `${open}\n${sentinel}`;
    }
    if (endings.has(parsed.name) && stack.at(-1)?.end === parsed.name && !parsed.arguments) {
      const { name } = stack.pop();
      const close = `</${name}>`;
      placeholders.entries.push({ key: close, value: parsed.text, mode: 'exact' });
      return `${sentinel}\n${close}`;
    }
    return placeholders.add(parsed.text, name => `<!--${name}-->`);
  }).join('\n');
  // Incomplete DSL is normal while editing. Virtual closing elements influence
  // indentation only; they are removed, never inserted into the template.
  while (stack.length) {
    const { name } = stack.pop();
    const close = `</${name}>`;
    placeholders.entries.push({ key: close, value: '', mode: 'line' });
    result += `\n${sentinel}\n${close}`;
  }
  return result;
}

function indentDirectives(source, indent) {
  const stack = [];
  return source.split('\n').map(line => {
    const parsed = directive(line);
    if (!parsed) return line;
    if (stack.at(-1) === parsed.name && !parsed.arguments) stack.pop();
    const result = indent.repeat(stack.length) + parsed.text;
    if (pairs.has(parsed.name)) stack.push(pairs.get(parsed.name));
    return result;
  }).join('\n');
}

async function formatChunk(source, options) {
  if (!source.trim()) return source;
  if (/^[\t ]*@previewData\b/.test(source)) {
    const block = /^[\t ]*@previewData[\t ]*\n([\s\S]*?)\n[\t ]*@endpreviewData[\t ]*(\n?)$/.exec(source);
    if (!block) return source;
    try {
      const data = JSON.parse(block[1]);
      if (data === null || Array.isArray(data) || typeof data !== 'object') return source;
      const body = await prettier.format(block[1], { ...options, parser: 'json', embeddedLanguageFormatting: 'off' });
      return `@previewData\n${body}@endpreviewData${block[2]}`;
    } catch {
      return source;
    }
  }
  const placeholders = new Placeholders(source);
  const leading = source.match(/^\n*/)[0];
  const trailing = source.match(/\n*$/)[0];
  const raw = protectComments(await protectRawElements(source, placeholders, options), placeholders);
  const beforeHtml = placeholders.entries.length;
  const masked = maskDirectives(interpolations(raw, placeholders), placeholders);
  let result;
  try {
    result = await prettier.format(breakBlockElements(masked), { ...options, parser: 'html', embeddedLanguageFormatting: 'off' });
  } catch {
    // A malformed HTML fragment does not stop independent blocks, metadata or
    // valid embedded languages elsewhere in the file from being formatted.
    placeholders.entries.splice(beforeHtml);
    result = indentDirectives(raw, options.indent);
  }
  result = placeholders.restore(result);
  if (result === null) return source;
  return leading + result.replace(/^\n+|\n+$/g, '') + trailing;
}

function chunks(source) {
  const result = [];
  let pending = '';
  let end = null;
  for (const line of source.match(/[^\n]*(?:\n|$)/g) || []) {
    if (!line) continue;
    const parsed = directive(line.replace(/\n$/, ''));
    if (!end && parsed && ['block', 'layout', 'previewData'].includes(parsed.name)) {
      if (pending) result.push(pending);
      pending = '';
      end = parsed.name === 'previewData' ? 'endpreviewData' : pairs.get(parsed.name);
    }
    pending += line;
    if (end && parsed?.name === end && !parsed.arguments) {
      result.push(pending);
      pending = '';
      end = null;
    }
  }
  if (pending) result.push(pending);
  return result;
}

/** Format a TPL document without running template or workspace code. */
async function formatDocument(text, settings = {}) {
  if (!text) return text;
  const eol = text.match(/\r\n|\r|\n/)?.[0] || '\n';
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  let source = text.slice(bom.length).replace(/\r\n|\r/g, '\n');
  const php = new Placeholders(source);
  for (const span of phpSpans(source).reverse()) {
    const replacement = php.add(source.slice(span.start, span.end), name => `<!--${name}-->`);
    source = source.slice(0, span.start) + replacement + source.slice(span.end);
  }
  const tabWidth = Number.isInteger(settings.tabSize) ? Math.max(1, Math.min(16, settings.tabSize)) : 2;
  const useTabs = settings.insertSpaces === false;
  const options = {
    plugins,
    tabWidth,
    useTabs,
    printWidth: Number.isInteger(settings.printWidth) ? Math.max(40, Math.min(320, settings.printWidth)) : 100,
    endOfLine: 'lf',
    indent: useTabs ? '\t' : ' '.repeat(tabWidth),
  };
  const formatted = (await Promise.all(chunks(source).map(chunk => formatChunk(chunk, options)))).join('');
  const result = php.restore(formatted) ?? text.slice(bom.length).replace(/\r\n|\r/g, '\n');
  return bom + (result.endsWith('\n') ? result : result + '\n').replace(/\n/g, eol);
}

module.exports = { formatDocument };
