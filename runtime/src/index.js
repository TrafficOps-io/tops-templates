import {encodeSegments} from './html.js';
import {renderRichText, isRichTextEmpty, richTextImageSources} from './rich-text.js';
/** Browser-safe interpreter for the documented JavaScript subset of Template DSL v1. */
const TYPES = Object.freeze({String: 'text', Text: 'textarea', Wysiwyg: 'wysiwyg', Markdown: 'markdown', Color: 'color', Number: 'number', Range: 'range', Boolean: 'checkbox', Image: 'image', Url: 'url', Email: 'email', Select: 'select'});
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CSS = new Set(['media', 'supports', 'font-face', 'keyframes', '-webkit-keyframes', 'import', 'charset', 'layer', 'container', 'property', 'page', 'namespace', 'scope', 'starting-style']);
const encoder = new TextEncoder();
const programs = new WeakMap();
// Numeric limits follow the PHP reference implementation (ADR-0001). outputBytes bounds one page and all rendered pages of a project.
export const LIMITS = Object.freeze({sourceBytes: 2 * 1024 * 1024, projectBytes: 32 * 1024 * 1024, files: 500, pages: 100, fields: 200, depth: 6, includeDepth: 10, items: 50, operations: 100000, outputBytes: 8 * 1024 * 1024, textBytes: 10000, longTextBytes: 100000});
export class TemplateError extends Error { constructor(message) { super(message); this.name = 'TemplateError'; } }
const fail = (message) => { throw new TemplateError(message); };
const bytes = (value) => typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength;
const own = (object, key) => object != null && Object.hasOwn(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
function identifier(value, what = 'identifier') { if (!IDENT.test(value) || FORBIDDEN.has(value)) fail(`Invalid ${what}: ${value}`); return value; }
export function safePath(path) {
  if (typeof path !== 'string' || !path || bytes(path) > 255 || /[\\:%?#\x00-\x20\x7f]/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part.startsWith('.') || FORBIDDEN.has(part))) fail(`Unsafe project path: ${path}`);
  if (/\.(?:php\d*|phtml|phar|blade(?:\.php)?|cgi|pl|py|rb|sh|asp|aspx|jsp)(?:\.|$)/i.test(path)) fail('Source names must be safe relative paths without executable extensions.');
  return path;
}
function joined(from, path) { safePath(path); return safePath([...from.split('/').slice(0, -1), path].join('/')); }
function decode(value, path) { if (typeof value === 'string') return value; try { return new TextDecoder('utf-8', {fatal: true}).decode(value); } catch { fail(`${path}: template must be valid UTF-8`); } }

// This tokenizer handles quoted fragments inside an option, e.g. label="Two words".
function words(input) {
  const result = []; let word = '', quote = '', active = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\') { const next = input[++i]; if (next === undefined) fail('Unterminated escape'); word += ({n:'\n', r:'\r', t:'\t'}[next] ?? next); }
      else word += char;
    } else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char)) { if (active) result.push(word); word = ''; active = false; }
    else { word += char; active = true; }
  }
  if (quote) fail('Unterminated quoted argument');
  if (active) result.push(word);
  return result;
}
function options(tokens, allowed) {
  const result = {};
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], key, value;
    if (token === '=') { key = 'default'; value = tokens[++i]; }
    else if (token.startsWith('=')) { key = 'default'; value = token.slice(1) || tokens[++i]; }
    else if (token.includes('=')) { const at = token.indexOf('='); key = token.slice(0, at); value = token.slice(at + 1); }
    else { key = token; value = true; }
    if (!key || value === undefined || (allowed && !allowed.includes(key))) fail(`Unsupported option: ${key || token}`);
    if (own(result, key)) fail(`Duplicate option: ${key}`);
    if (value === true && key !== 'required') fail(`Option ${key} needs a value`);
    if (FORBIDDEN.has(key)) fail(`Unsafe option: ${key}`);
    result[key] = value;
  }
  return result;
}
const fieldLocations = new WeakMap();
function atSource(error, origin) {
  if (origin && !error.file) { error.file = origin.file; error.line = origin.line; }
  return error;
}
function expand(source, filename, resolver, stack = [], budget = {bytes: 0, lines: 0}) {
  if (typeof source !== 'string') fail(`${filename}: source must be text`);
  const rows = source.replace(/\r\n?/g, '\n').split('\n');
  budget.bytes += bytes(source); budget.lines += rows.length;
  if (budget.bytes > LIMITS.sourceBytes || budget.lines > 20000) fail('Expanded source exceeds its budget');
  if (stack.includes(filename) || stack.length > LIMITS.includeDepth) fail(`Include cycle or depth limit at ${filename}`);
  const output = [], origins = [];
  for (const [index, row] of rows.entries()) {
    const origin = {file:filename, line:index + 1};
    const include = /^\s*@include\s+([^\r\n]+)\s*$/.exec(row);
    if (!include) { output.push(row); origins.push(origin); continue; }
    try {
      const tokens = words(include[1]);
      if (tokens.length !== 1) fail('@include needs one path');
      const path = safePath(tokens[0]);
      if (!/\.tpl(?:\.html)?$/i.test(path)) fail('Includes must use .tpl or .tpl.html');
      if (!resolver) fail(`No include resolver for ${path}`);
      const next = joined(filename, path), content = resolver(path, filename);
      if (typeof content !== 'string') fail(`Include resolver did not return text for ${next}`);
      assertSource(content, next);
      const expanded = expand(content, next, resolver, [...stack, filename], budget);
      output.push(...expanded.text.split('\n')); origins.push(...expanded.origins);
    } catch (error) { throw atSource(error, origin); }
  }
  return {text:output.join('\n'), origins};
}
function rawField(args, origin) {
  try {
  const [name, author_type, ...rest] = words(args);
  identifier(name, 'field name');
  if (!/^[A-Z][A-Za-z0-9_]*(?:\[\])?$/.test(author_type ?? '')) fail(`Invalid type for ${name}`);
  const field = {name, author_type, ...options(rest)};
  if (origin) fieldLocations.set(field, origin);
  return field;
  } catch (error) { throw atSource(error, origin); }
}
function assertSource(source, filename) {
  if (/<\?|<%|\{!!|<script\b[^>]*\blanguage\s*=\s*['"]?php\b|@(?:php|endphp|extends|yield|inject|use|component|endcomponent|livewire|vite|csrf|method|auth|endauth|guest|endguest|can|endcan|cannot|endcannot|foreach|endforeach|forelse|endforelse|while|endwhile|for|endfor|switch|endswitch|once|endonce|push|endpush|stack|verbatim|endverbatim|validation|endvalidation)\b|@(?:include|if|elseif|unless|each)\s*\(|\{\{\s*\$/i.test(source)) throw Object.assign(new TemplateError(`${filename}: Executable PHP, Blade and request validation sources are unsupported.`), {file:filename, line:null});
}
function collect(source, filename, resolver, suppliedOrigins) {
  assertSource(source, filename);
  const expanded = suppliedOrigins ? {text:source, origins:suppliedOrigins} : expand(source, filename, resolver);
  const lines = expanded.text.split('\n'), origins = expanded.origins;
  const result = {sections: [], types: {}, blocks: {}, fields: [], filename, meta: {}, layout: null};
  const ids = new Set(); let section = null;
  const body = (start, end) => { const rows = []; let i = start + 1; for (; i < lines.length && lines[i].trim() !== `@${end}`; i++) rows.push(lines[i]); if (i === lines.length) fail(`${filename}:${start + 1}: missing @${end}`); return {text: rows.join('\n'), end: i}; };
  for (let i = 0; i < lines.length; i++) {
    try {
    const line = lines[i].trim(); if (!line || line.startsWith('<!--') && line.endsWith('-->')) continue;
    const match = /^@([A-Za-z]+)(?:\s+(.*))?$/.exec(line);
    if (!match) fail(`${filename}:${i + 1}: content belongs inside @layout or @block`);
    const [, directive, args = ''] = match;
    if (directive === 'template') {
      if (result.meta.name !== undefined) fail('Duplicate @template');
      const [name, ...rest] = words(args); if (!name?.trim()) fail('@template needs a name');
      const declaration = {name, ...options(rest, ['version', 'description', 'previewData', 'previewUrl'])};
      if (result.meta.previewData !== undefined && declaration.previewData !== undefined) fail('Duplicate preview data');
      result.meta = {...result.meta, ...declaration};
      if (result.meta.version !== undefined && result.meta.version !== '1') fail('Only template version 1 is supported');
    } else if (directive === 'section') {
      if (section) fail('Sections cannot nest');
      const [id, label = id, ...rest] = words(args); identifier(id, 'section');
      if (rest.length || ids.has(id)) fail(`Duplicate or invalid section ${id}`);
      section = {id, label, fields: []}; ids.add(id); result.sections.push(section);
    } else if (directive === 'endsection') { if (!section || args) fail('Unexpected @endsection'); section = null; }
    else if (directive === 'param') {
      const field = rawField(args, origins[i]); if (result.fields.some((f) => f.name === field.name)) fail(`Duplicate field ${field.name}`);
      if (!section && !result.sections.some((s) => s.id === 'general')) { result.sections.push({id:'general', label:'General', fields:[]}); ids.add('general'); }
      (section || result.sections.find((s) => s.id === 'general')).fields.push(field); result.fields.push(field);
    } else if (directive === 'type') {
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(args) || own(TYPES, args) || own(result.types, args)) fail(`Invalid or duplicate type ${args}`);
      const start = i, collected = body(i, 'endtype'); i = collected.end;
      result.types[args] = collected.text.split('\n').map((row, at) => { if (!row.trim()) return null; const m = /^\s*@param\s+(.+)$/.exec(row); if (!m) fail('Types only contain @param declarations'); return rawField(m[1], origins[start + at + 1]); }).filter(Boolean);
    } else if (directive === 'block') {
      const signature = /^([A-Za-z][A-Za-z0-9_]*)\(([^)]*)\)(.*)$/.exec(args);
      if (!signature) fail('Invalid @block signature');
      const [, name, parameters, rest] = signature; identifier(name, 'block');
      if (own(result.blocks, name)) fail(`Duplicate block ${name}`);
      const params = parameters.trim() ? parameters.split(',').map((part) => { const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*([A-Z][A-Za-z0-9_]*(?:\[\])?)\s*$/.exec(part); if (!m) fail('Invalid block parameter'); identifier(m[1]); return {name:m[1], author_type:m[2]}; }) : [];
      if (new Set(params.map((p) => p.name)).size !== params.length) fail('Duplicate block parameter');
      const collected = body(i, 'endblock'); i = collected.end;
      result.blocks[name] = {params, body: collected.text, ...options(words(rest), ['aiInstructions'])};
    } else if (directive === 'layout') {
      if (result.layout !== null || args || section) fail('Each page needs exactly one top-level @layout');
      const collected = body(i, 'endlayout'); i = collected.end; result.layout = collected.text;
    } else if (directive === 'previewData') {
      if (result.meta.previewData !== undefined) fail('Duplicate preview data');
      const collected = body(i, 'endpreviewData'); i = collected.end; result.meta.previewData = collected.text;
    } else fail(`${filename}:${i + 1}: unsupported directive @${directive}`);
    } catch (error) { throw atSource(error, origins[i]); }
  }
  if (section) fail('Unclosed @section');
  if (result.layout === null || !result.layout.trim()) fail(`${filename}: exactly one non-empty @layout is required`);
  return result;
}
function normalizeFields(raw, types, seen = [], counter = {value:0}) {
  if (seen.length > LIMITS.depth) fail('Field nesting exceeds six levels');
  const names = new Set();
  return raw.map((field) => {
    try {
    if (++counter.value > LIMITS.fields) fail('Too many fields');
    if (names.has(field.name)) fail(`Duplicate field ${field.name}`); names.add(field.name);
    const {name, author_type, ...opts} = field;
    const array = author_type.endsWith('[]'), base = author_type.replace(/\[\]$/, '');
    const type = TYPES[base] || (array ? 'repeater' : 'group');
    if (array && own(TYPES, base)) fail('Only custom types can be repeaters');
    if (!own(TYPES, base) && !own(types, base)) fail(`Unknown type ${base}`);
    if (seen.includes(base)) fail(`Recursive type ${base}`);
    const normalized = {...opts, name, author_type, type, label:opts.label ?? name, help:opts.help ?? '', required:opts.required === true || opts.required === 'true'};
    if (opts.required !== undefined && ![true, 'true', 'false'].includes(opts.required)) fail(`Invalid required option on ${name}`);
    for (const key of ['min', 'max', 'step', 'min_items', 'max_items']) if (own(opts, key)) { const n = Number(opts[key]); if (!String(opts[key]).trim() || !Number.isFinite(n)) fail(`Invalid ${key} on ${name}`); normalized[key] = n; }
    const reserved = {options:['select'], min:['number','range'], max:['number','range'], step:['number','range'], min_items:['repeater'], max_items:['repeater'], fields:['group','repeater'], aspect_ratio:['image'], sizes:['image']};
    for (const [key, permitted] of Object.entries(reserved)) if (own(opts, key) && !permitted.includes(type)) fail(`${key} does not apply to ${author_type}`);
    if (own(opts, 'fields')) fail('Use @type to declare child fields');
    if (type === 'group' || type === 'repeater') normalized.fields = normalizeFields(types[base], types, [...seen, base], counter);
    if (type === 'repeater') {
      normalized.min_items ??= 0; normalized.max_items ??= LIMITS.items;
      if (![normalized.min_items, normalized.max_items].every((n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.items) || normalized.min_items > normalized.max_items) fail(`Invalid repeater bounds on ${name}`);
    }
    if (normalized.min > normalized.max || normalized.step !== undefined && normalized.step <= 0) fail(`Invalid numeric bounds on ${name}`);
    if (type === 'select') {
      if (typeof opts.options !== 'string' || !opts.options) fail(`Select ${name} needs options`);
      normalized.options = Object.fromEntries(opts.options.split('|').map((entry) => { const at = entry.indexOf(':'); const key = at < 0 ? entry : entry.slice(0, at), label = at < 0 ? entry : entry.slice(at + 1); if (!key || !label || FORBIDDEN.has(key)) fail('Invalid Select option'); return [key,label]; }));
    }
    if (opts.aspect_ratio && opts.sizes) fail('Use aspect_ratio or sizes, not both');
    if (opts.aspect_ratio !== undefined) { const parts = String(opts.aspect_ratio).split(':').map(Number); normalized.aspect_ratio = parts.length === 2 ? parts[0] / parts[1] : parts[0]; if (parts.length > 2 || !Number.isFinite(normalized.aspect_ratio) || normalized.aspect_ratio < .01 || normalized.aspect_ratio > 100) fail('Invalid image aspect_ratio'); }
    if (opts.sizes !== undefined) normalized.sizes = String(opts.sizes).split('|').map((size) => { const m = /^(\d+)x(\d+)$/.exec(size); if (!m || +m[1] < 1 || +m[2] < 1 || +m[1] > 4096 || +m[2] > 4096) fail('Invalid image size'); return {width:+m[1], height:+m[2], label:size}; });
    if (own(opts, 'default')) {
      if (['number','range'].includes(type)) { normalized.default = Number(opts.default); if (!String(opts.default).trim() || !Number.isFinite(normalized.default)) fail(`Invalid default for ${name}`); }
      else if (type === 'checkbox') { if (!['true','false'].includes(opts.default)) fail(`Invalid Boolean default for ${name}`); normalized.default = opts.default === 'true'; }
      else if (['group','repeater'].includes(type)) { try { normalized.default = JSON.parse(opts.default); } catch { fail(`Default for ${name} must be JSON`); } }
    }
    return normalized;
    } catch (error) { throw atSource(error, fieldLocations.get(field)); }
  });
}
function boundedCopy(value, budget, depth = 0) {
  if (++budget.value > 10000 || depth > 16) fail('Default values exceed their budget');
  if (Array.isArray(value)) return value.map((item) => boundedCopy(item,budget,depth+1));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key,item]) => { if (FORBIDDEN.has(key)) fail('Unsafe default key'); return [key,boundedCopy(item,budget,depth+1)]; }));
  return value;
}
function fallback(field, budget = {value:0}) {
  if (++budget.value > 10000) fail('Default values exceed their budget');
  if (own(field, 'default')) return boundedCopy(field.default,budget);
  if (field.type === 'group') return Object.fromEntries(field.fields.map((child) => [child.name, fallback(child,budget)]));
  if (field.type === 'repeater') return Array.from({length:field.min_items}, () => Object.fromEntries(field.fields.map((child) => [child.name, fallback(child,budget)])));
  if (field.type === 'checkbox') return false;
  // An unset optional field is empty: no implicit color, minimum number or first option (matches PHP).
  return '';
}
export function getDefaults(definition) { return normalizeValues(definition.fields, {}, '', {value:0}, true, []); }

// Value coercion and validation mirror TemplateEngine::normalizeField in PHP; where JavaScript
// cannot reproduce a PHP rule exactly it is stricter, never looser.
const PHP_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const PHP_BLANK = /^[ \t\n\r\x0B]*$/;
const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** PHP truthiness: "" and "0" are the only falsey strings; empty lists and groups are falsey. */
export function phpTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return typeof value === 'string' ? value !== '' && value !== '0' : Boolean(value);
}
const rawurldecode = (value) => value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
function safeValueUrl(value, allowRelative) {
  if (bytes(value) > 2048) return false;
  // Decode repeatedly so encoded controls, schemes and traversal cannot bypass validation (PHP decodes up to five times).
  let decoded = value;
  for (let i = 0; i < 5; i++) { const next = rawurldecode(decoded); if (next === decoded) break; decoded = next; }
  if (/[\x00-\x20\x7f\\]/.test(decoded) || decoded.startsWith('//') || decoded.includes('%')) return false;
  if (/^https?:\/\//i.test(value)) {
    // At least as strict as PHP's FILTER_VALIDATE_URL: printable ASCII, a DNS or IP-literal host, no credentials.
    if (/[^\x21-\x7e]/.test(value)) return false;
    let url; try { url = new URL(value); } catch { return false; }
    if (url.username || url.password || !url.hostname) return false;
    return /^\[[0-9A-Fa-f:.]+\]$/.test(url.hostname) || url.hostname.split('.').every((label) => DNS_LABEL.test(label));
  }
  if (!allowRelative || decoded.startsWith('/') || decoded.includes(':') || decoded.includes('?') || decoded.includes('#')) return false;
  return decoded.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
function safeEmail(value) {
  // A subset of PHP's FILTER_VALIDATE_EMAIL: dot-atom local part and a dotted DNS domain; quoted local parts and IP literals are rejected.
  const at = value.lastIndexOf('@');
  if (at < 1 || value.length > 254) return false;
  const local = value.slice(0, at), labels = value.slice(at + 1).split('.');
  return local.length <= 64 && EMAIL_LOCAL.test(local) && labels.length >= 2 && labels.every((label) => DNS_LABEL.test(label));
}
function safeUrl(value, action = false) {
  if (!value) return !action;
  if (/[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//')) return false;
  if (/^https?:\/\//i.test(value)) { try { const url = new URL(value); return (!action || url.protocol === 'https:') && !url.username && !url.password; } catch { return false; } }
  if (action) return value.startsWith('/') && !value.startsWith('//');
  return !/^[^/?#]*:/.test(value) && !value.startsWith('//');
}
function normalizeValues(fields, data, path = '', budget = {value:0}, allowMissingRequired = false, warnings = []) {
  if (!isObject(data)) fail(`${path || 'Data'} must be an object`);
  for (const key of Object.keys(data)) {
    if (FORBIDDEN.has(key)) fail(`Unsafe value key: ${path}${key}`);
    // A key without a field (for example one the template retired) is dropped, not fatal (matches PHP).
    if (!fields.some((field) => field.name === key)) warnings.push({path:`${path}${key}`, message:'This setting is not defined in the template.'});
  }
  return Object.fromEntries(fields.map((field) => {
    if (++budget.value > 10000) fail('Too many setting values');
    const name = `${path}${field.name}`;
    let value = own(data, field.name) ? data[field.name] : fallback(field);
    if (field.type === 'group') value = normalizeValues(field.fields, value, `${name}.`, budget, allowMissingRequired, warnings);
    else if (field.type === 'repeater') {
      if (!Array.isArray(value) || value.length < field.min_items || value.length > field.max_items) fail(`${name} needs ${field.min_items}–${field.max_items} items`);
      if (!allowMissingRequired && field.required && !value.length) fail(`${name} is required`);
      value = value.map((item, index) => normalizeValues(field.fields, item, `${name}[${index}].`, budget, allowMissingRequired, warnings));
    } else if (field.type === 'checkbox') {
      // PHP accepts true/false, 0/1 and "0"/"1" only; null is not a boolean.
      if (![true, false, 0, 1, '0', '1'].includes(value)) fail(`${name} must be a boolean`);
      value = Boolean(Number(value));
    } else {
      if (value === null) value = '';
      if (!allowMissingRequired && field.required && typeof value === 'string' && PHP_BLANK.test(value)) fail(`${name} is required`);
      if (['number','range'].includes(field.type)) {
        if (value === '') return [field.name, ''];
        const number = typeof value === 'number' ? value : typeof value === 'string' && PHP_NUMERIC.test(value) ? Number(value.trim()) : NaN;
        if (!Number.isFinite(number)) fail(`${name} must be a finite number`);
        if (field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) fail(`${name} is outside its numeric bounds`);
        if (field.step !== undefined) { const steps = (number - (field.min ?? 0)) / field.step; if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 0.000001) fail(`${name} must follow step ${field.step}`); }
        return [field.name, number];
      }
      if (field.type === 'select' && typeof value === 'number' && Number.isFinite(value)) value = String(value);
      const limit = ['textarea','wysiwyg','markdown'].includes(field.type) ? LIMITS.longTextBytes : LIMITS.textBytes;
      if (typeof value !== 'string' || !value.isWellFormed() || bytes(value) > limit || CONTROL_CHARS.test(value)) fail(`${name} must be valid text of at most ${limit} bytes`);
      if (['markdown','wysiwyg'].includes(field.type)) {
        if (field.type === 'markdown' && value.split('\n').some((line) => (line.match(/[\[\]*_~`>]/g) || []).length > 1000)) fail(`${name} exceeds the Markdown delimiter budget`);
        const html = renderRichText(field.type, value);
        for (const source of richTextImageSources(html)) if (!safeValueUrl(source, true)) fail(`${name} must use HTTP(S) image URLs or safe relative image paths`);
        if (!allowMissingRequired && field.required && isRichTextEmpty(html)) fail(`${name} is required`);
      }
      if (value && field.type === 'url' && !safeValueUrl(value, false)) fail(`${name} must be an HTTP(S) URL`);
      if (value && field.type === 'image') { if (!safeValueUrl(value, true)) fail(`${name} must be an HTTP(S) URL or a safe relative image path`); if (!/^https?:\/\//i.test(value)) safePath(value); }
      if (value && field.type === 'email' && !safeEmail(value)) fail(`${name} must be an email address`);
      if (value && field.type === 'color' && !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) fail(`${name} must be a hex color`);
      if (value && field.type === 'select' && !own(field.options, value)) fail(`${name} must be a listed option`);
    }
    return [field.name, value];
  }));
}
/** Unknown keys are dropped; pass `{warnings: []}` to collect them as `{path, message}`. Type violations throw. */
export function validateValues(definition, data = {}, {warnings = []} = {}) { return normalizeValues(definition.fields, data, '', {value:0}, false, warnings); }

function parseBody(body) {
  // Lower line directives into a token stream. Every lookup remains a node, never evaluated code.
  const tokens = []; let text = '';
  const flush = () => { if (text) tokens.push({kind:'text', value:text}); text = ''; };
  for (const row of body.split('\n')) {
    const literal = /^([ \t]*)@@/.exec(row);
    if (literal) { text += row.replace('@@', '@') + '\n'; continue; }
    const match = /^\s*@([A-Za-z-]+)(?:\s+(.*))?\s*$/.exec(row);
    if (!match || CSS.has(match[1])) { text += row + '\n'; continue; }
    flush(); const [, directive, args = ''] = match;
    if (directive === 'unless') tokens.push({kind:'open', mode:'inverse', path:args.replace(/:\s*$/, '').trim(), close:'endunless'});
    else if (directive === 'if') tokens.push({kind:'open', mode:'if', path:args.replace(/:\s*$/, '').trim(), close:'endif'});
    else if (directive === 'each') { const m = /^([A-Za-z][A-Za-z0-9_]*)\s+in\s+(.*?)\s*:??$/.exec(args); if (!m) fail('Invalid @each'); tokens.push({kind:'open', mode:'each', alias:identifier(m[1]), path:m[2].replace(/:$/, '').trim(), close:'endeach'}); }
    else if (directive === 'endif' || directive === 'endunless' || directive === 'endeach') { if (args) fail(`Invalid @${directive}`); tokens.push({kind:'close', close:directive}); }
    else if (directive === 'render') { const m = /^([A-Za-z][A-Za-z0-9_]*)\(([^)]*)\)$/.exec(args); if (!m) fail('Invalid @render'); tokens.push({kind:'block', name:m[1], args:m[2].trim() ? m[2].split(',').map((p) => p.trim()) : []}); }
    else fail(`Unsupported body directive @${directive}`);
  }
  flush();
  const flat = tokens.flatMap((token) => {
    if (token.kind !== 'text') return [token];
    for (const candidate of token.value.matchAll(/(?<!\{)\{(?:query|headers|body|actions|locale)(?:\.[^{}]*)?\}(?!\})/g)) if (!/^\{(?:locale|(?:query|actions)\.[A-Za-z][A-Za-z0-9_]*)\}$/.test(candidate[0])) fail('Runtime tokens only support {query.name}, {locale} and {actions.name}');
    const parts = []; let end = 0;
    const regex = /\{\{([\s\S]*?)\}\}|\{(query\.[A-Za-z][A-Za-z0-9_]*|actions\.[A-Za-z][A-Za-z0-9_]*|locale)\}/g;
    for (const match of token.value.matchAll(regex)) {
      if (match.index > end) parts.push({kind:'text', value:token.value.slice(end, match.index)});
      if (match[2]) parts.push({kind:'runtime', path:match[2]});
      else {
        const expr = match[1].trim(), prefix = expr[0], path = expr.slice(1).trim();
        if (prefix === '#' || prefix === '^') parts.push({kind:'open', mode:prefix === '#' ? 'section' : 'inverse', path, close:`/${path}`});
        else if (prefix === '/') parts.push({kind:'close', close:`/${path}`});
        else if (prefix === '>') fail('Named JSON partials are not supported by the JavaScript source runtime; use @block');
        else parts.push({kind:'value', path:prefix === '&' ? path : expr, rich:prefix === '&'});
      }
      end = match.index + match[0].length;
    }
    if (end < token.value.length) parts.push({kind:'text', value:token.value.slice(end)});
    return parts;
  });
  const root = [], stack = [{children:root}];
  for (const token of flat) {
    if (token.kind === 'close') { if (stack.length === 1 || stack.at(-1).close !== token.close) fail(`Unexpected closing directive ${token.close}`); stack.pop(); }
    else if (token.kind === 'open') { token.children = []; stack.at(-1).children.push(token); stack.push(token); if (stack.length > 32) fail('Body nesting limit exceeded'); }
    else stack.at(-1).children.push(token);
  }
  if (stack.length !== 1) fail(`Missing closing directive ${stack.at(-1).close}`);
  return root;
}
function pathParts(path) {
  if (typeof path !== 'string' || path.length > 255) fail('Invalid expression path');
  let parent = 0, root = false;
  if (path.startsWith('@root.')) { root = true; path = path.slice(6); }
  while (path.startsWith('../')) { parent++; path = path.slice(3); }
  const parts = path.split('.'); parts.forEach((part) => identifier(part, 'expression path'));
  return {parent, root, parts};
}
function lookup(path, scope, field = false) {
  const {parent, root, parts} = pathParts(path); let target = root ? scope.root : scope;
  for (let i = 0; i < parent; i++) { if (!target.parent) fail(`Path escapes its scope: ${path}`); target = target.parent; }
  let value;
  const key = field ? 'schema' : 'data';
  if (own(target.bindings, parts[0])) { value = target.bindings[parts.shift()][key]; }
  else if (own(target[key], parts[0])) value = target[key][parts.shift()];
  else if (!root && parent === 0 && !scope.block && own(scope.root[key], parts[0])) value = scope.root[key][parts.shift()];
  else fail(`Unknown expression path: ${path}`);
  for (const part of parts) {
    if (field) { if (!['group','repeater'].includes(value?.type)) fail(`Not a group: ${path}`); value = value.fields.find((item) => item.name === part); if (!value) fail(`Unknown expression path: ${path}`); }
    else { if (!own(value, part)) fail(`Unknown expression path: ${path}`); value = value[part]; }
  }
  return value;
}
function schemaMap(fields) { return Object.fromEntries(fields.map((field) => [field.name, field])); }
function rootScope(fields, data = {}) { const scope = {schema:schemaMap(fields), data, bindings:{}, parent:null, block:false}; scope.root = scope; return scope; }
function childScope(scope, field, data, alias) {
  // Named @each aliases have lexical scope; raw {{#sections}} retain Mustache context.
  const child = {schema:alias ? scope.schema : schemaMap(field.fields || []), data:alias ? scope.data : data || {}, bindings:{...scope.bindings}, parent:scope, root:scope.root, block:scope.block};
  if (alias) child.bindings[alias] = {schema:{...field, type:'group', author_type:field.author_type.replace(/\[\]$/, '')}, data};
  return child;
}
function checkProgram(nodes, scope, blocks, stack = [], budget = {value:0}) {
  for (const node of nodes) {
    if (++budget.value > LIMITS.operations) fail('Block expansion budget exceeded');
    if (node.kind === 'text' || node.kind === 'runtime') continue;
    if (node.kind === 'block') {
      if (!own(blocks, node.name)) fail(`Unknown block ${node.name}`);
      if (stack.includes(node.name) || stack.length >= 20) fail(`Recursive or excessively deep block ${node.name}`);
      const block = blocks[node.name]; if (node.args.length !== block.params.length) fail(`Wrong argument count for block ${node.name}`);
      const bindings = {};
      block.params.forEach((param, index) => { const field = lookup(node.args[index], scope, true); if (field.author_type !== param.author_type) fail(`Block ${node.name}: ${param.name} expects ${param.author_type}`); bindings[param.name] = {schema:field}; });
      const child = {schema:{}, data:{}, bindings, root:null, parent:null, block:true}; child.root = child;
      checkProgram(block.nodes, child, blocks, [...stack,node.name], budget);
    } else {
      const field = lookup(node.path, scope, true);
      if (node.kind === 'value') {
        if (['group','repeater'].includes(field.type)) fail(`Cannot interpolate group or repeater ${node.path}`);
        if (node.rich && !['markdown','wysiwyg'].includes(field.type)) fail('Formatted output requires a Markdown or Wysiwyg field');
      } else {
        if (node.mode === 'each' && field.type !== 'repeater') fail(`@each requires a repeater: ${node.path}`);
        if (node.mode === 'if' && field.type === 'repeater') fail(`Use @each for lists: ${node.path}`);
        const enters = node.mode === 'each' || node.mode === 'section' && ['group','repeater'].includes(field.type);
        checkProgram(node.children, enters ? childScope(scope, field, {}, node.alias) : scope, blocks, stack, budget);
      }
    }
  }
}
function build(collected, shared = collected) {
  const fields = normalizeFields(shared.fields, shared.types);
  const map = schemaMap(fields);
  const sections = shared.sections.map((section) => ({id:section.id, label:section.label, fields:section.fields.map((field) => map[field.name])}));
  const meta = collected.meta;
  const definition = {version:1, name:meta.name || 'Imported template', description:meta.description || '', sections, fields, html:collected.layout, partials:{}, source:collected.filename, entrypoint:outputPath(collected.filename)};
  const blocks = Object.fromEntries(Object.entries(shared.blocks).map(([name, block]) => [name, {...block, nodes:parseBody(block.body)}]));
  const nodes = parseBody(collected.layout); checkProgram(nodes, rootScope(fields), blocks);
  definition.blocks = Object.fromEntries(Object.entries(blocks).filter(([,block]) => block.aiInstructions !== undefined).map(([name, block]) => [name, {aiInstructions:block.aiInstructions}]));
  if (meta.previewUrl) { if (!/^https?:\/\//i.test(meta.previewUrl) || !safeUrl(meta.previewUrl)) fail('previewUrl must be an HTTP(S) URL'); definition.previewUrl = meta.previewUrl; }
  if (meta.previewData !== undefined) {
    let preview; try { preview = JSON.parse(meta.previewData); } catch { fail('previewData must be valid JSON'); }
    // Preview data is part of the definition, so an unknown key there is an authoring error.
    const warnings = []; definition.previewData = validateValues(definition, preview, {warnings});
    if (warnings.length) fail(`previewData.${warnings[0].path}: ${warnings[0].message}`);
  }
  programs.set(definition, {nodes, blocks}); return definition;
}
export function parseTemplate(source, {filename = 'index.tpl', resolveInclude} = {}) { safePath(filename); return build(collect(source, filename, resolveInclude)); }
export function outputPath(filename) { return filename.replace(/\.tpl(?:\.html)?$/i, '.html'); }
function projectFiles(files) {
  if (!isObject(files) || !Object.keys(files).length || Object.keys(files).length > LIMITS.files) fail(`A project needs 1–${LIMITS.files} files`);
  let size = 0;
  const paths = new Set();
  for (const [path, data] of Object.entries(files)) { safePath(path); if (paths.has(path.toLowerCase())) fail(`Case-insensitive path collision: ${path}`); paths.add(path.toLowerCase()); if (typeof data !== 'string' && !(data instanceof Uint8Array)) fail(`Invalid content for ${path}`); size += bytes(data); }
  if (size > LIMITS.projectBytes) fail('Project exceeds 32 MiB');
  return files;
}
export function parseProject(files) {
  projectFiles(files);
  const sourcePaths = Object.keys(files).filter((path) => /\.tpl(?:\.html)?$/i.test(path)).sort((a,b) => (a === 'index.tpl' || a === 'index.tpl.html' ? -1 : b === 'index.tpl' || b === 'index.tpl.html' ? 1 : a.localeCompare(b)));
  const included = new Set();
  const resolveInclude = (path, from) => { const key = joined(from, path); if (!own(files, key)) fail(`Missing include: ${key}`); included.add(key); return decode(files[key], key); };
  const expanded = new Map(sourcePaths.map((path) => [path, expand(decode(files[path], path),path,resolveInclude)]));
  const pages = sourcePaths.filter((path) => !included.has(path) && /^\s*@layout\s*$/m.test(expanded.get(path).text));
  const plain = Object.keys(files).filter(path => /\.html?$/i.test(path) && !/\.tpl\.html$/i.test(path) && !included.has(path));
  if (!pages.length && !plain.length || pages.length + plain.length > LIMITS.pages) fail(`A project needs 1–${LIMITS.pages} entry templates containing @layout after includes`);
  const collected = [...pages.map(path => collect(expanded.get(path).text, path, undefined, expanded.get(path).origins)), ...plain.map(path => {
    const source = decode(files[path], path); assertSource(source, path);
    return {sections:[], types:{}, blocks:{}, fields:[], filename:path, meta:{name:'Page'}, layout:source.replace(/^(\s*)@/gm, '$1@@')};
  })];
  const shared = {fields:[], sections:[], types:{}, blocks:{}};
  for (const page of collected) {
    for (const map of ['types','blocks']) for (const [name,value] of Object.entries(page[map])) { if (own(shared[map], name) && JSON.stringify(shared[map][name]) !== JSON.stringify(value)) fail(`Conflicting ${map}: ${name}`); shared[map][name] = value; }
    for (const section of page.sections) {
      let target = shared.sections.find((s) => s.id === section.id);
      if (!target) { target = {...section, fields:[]}; shared.sections.push(target); }
      for (const field of section.fields) {
        const existing = shared.fields.find((f) => f.name === field.name);
        if (existing && JSON.stringify(existing) !== JSON.stringify(field)) fail(`Conflicting field: ${field.name}`);
        if (!existing) { shared.fields.push(field); target.fields.push(field); }
      }
    }
  }
  if (shared.sections.length > 50) fail('Too many sections');
  const definitions = collected.map((page) => build(page, shared)).sort((a,b) => a.entrypoint === 'index.html' ? -1 : b.entrypoint === 'index.html' ? 1 : a.entrypoint.localeCompare(b.entrypoint, 'en', {numeric:true, sensitivity:'base'}));
  const outputs = new Set(Object.keys(files).filter((path) => !/\.tpl(?:\.html)?$/i.test(path) && !plain.includes(path)).map((path) => path.toLowerCase()));
  for (const definition of definitions) { const output = definition.entrypoint.toLowerCase(); if (outputs.has(output)) fail(`Output collision: ${definition.entrypoint}`); outputs.add(output); }
  for (const output of outputs) { const parts = output.split('/'); for (let i = 1; i < parts.length; i++) if (outputs.has(parts.slice(0,i).join('/'))) fail(`Output file/directory collision: ${output}`); }
  return {definition:definitions[0], pages:definitions, files};
}

// Keep values as opaque segments until all source has been interpreted. This prevents
// template-looking data from being interpreted during any later generation phase.
function renderSegments(nodes, scope, blocks, runtime, budget, output) {
  const append = (segment) => { budget.bytes += bytes(segment.value); if (budget.bytes > LIMITS.outputBytes) fail('Rendered output exceeds 8 MiB'); output.push(segment); };
  for (const node of nodes) {
    if (++budget.operations > LIMITS.operations) fail('Rendering operation budget exceeded');
    if (node.kind === 'text') append({value:node.value, literal:true});
    else if (node.kind === 'runtime') {
      const [kind,key] = node.path.split('.'); append({value:kind === 'locale' ? runtime.locale : runtime[kind][key] ?? '', runtime:kind});
    } else if (node.kind === 'value') { const value = lookup(node.path, scope), fieldType = lookup(node.path, scope, true).type; append({value:node.rich ? renderRichText(fieldType,value) : typeof value === 'boolean' ? value ? '1' : '' : String(value ?? ''), fieldType, rich:node.rich}); }
    else if (node.kind === 'block') {
      const block = blocks[node.name], bindings = {};
      block.params.forEach((param,index) => { bindings[param.name] = {schema:lookup(node.args[index], scope, true), data:lookup(node.args[index], scope)}; });
      const child = {schema:{}, data:{}, bindings, root:null, parent:null, block:true}; child.root = child;
      renderSegments(block.nodes, child, blocks, runtime, budget, output);
    } else {
      const field = lookup(node.path, scope, true), value = lookup(node.path, scope), truthy = phpTruthy(value);
      if (node.mode === 'inverse') { if (!truthy) renderSegments(node.children, scope, blocks, runtime, budget, output); }
      else if (node.mode === 'each' || node.mode === 'section' && field.type === 'repeater') { for (const item of value) renderSegments(node.children, childScope(scope, field, item, node.alias), blocks, runtime, budget, output); }
      else if (truthy) renderSegments(node.children, node.mode === 'section' && field.type === 'group' ? childScope(scope, field, value) : scope, blocks, runtime, budget, output);
    }
  }
}
function runtimeContext(context) {
  if (!isObject(context) || Object.keys(context).some((key) => !['query','locale','actions'].includes(key))) fail('Runtime context only accepts query, locale and actions');
  const result = {query:{}, actions:{}, locale:context.locale ?? ''};
  if (typeof result.locale !== 'string' || result.locale && !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(result.locale)) fail('Invalid locale');
  for (const key of ['query','actions']) {
    const map = context[key] ?? {}; if (!isObject(map) || Object.keys(map).length > 100) fail(`Invalid ${key} context`);
    for (const [name,value] of Object.entries(map)) { identifier(name); if (!['string','number','boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value) || bytes(String(value)) > 8192) fail(`Invalid runtime value ${key}.${name}`); result[key][name] = String(value); if (key === 'actions' && !safeUrl(result[key][name], true)) fail(`Unsafe action ${name}`); }
  }
  return result;
}
export function renderTemplate(definition, data = {}, context = {}, { draft = false } = {}) {
  const program = programs.get(definition); if (!program) fail('renderTemplate expects a definition returned by parseTemplate or parseProject');
  const relax = field => ({...field, required:false, ...(field.type === 'repeater' ? {min_items:0} : {}), ...(field.fields ? {fields:field.fields.map(relax)} : {})});
  const normalized = draft ? normalizeValues(definition.fields.map(relax), data) : validateValues(definition, data), runtime = runtimeContext(context), output = [];
  renderSegments(program.nodes, rootScope(definition.fields, normalized), program.blocks, runtime, {operations:0, bytes:0}, output);
  return encodeSegments(output, {fail, escape, safeUrl, bytes, maxBytes:LIMITS.outputBytes});
}
/** @returns {Record<string, string | Uint8Array>} */
export function generateProject(files, data = {}, context = {}, options = {}) {
  const project = parseProject(files), output = {};
  for (const [path,value] of Object.entries(files)) if (!/\.tpl(?:\.html)?$/i.test(path)) output[path] = value;
  let rendered = 0;
  for (const definition of project.pages) {
    const html = renderTemplate(definition, data, context, options);
    // PHP renderPages() bounds all rendered pages together by the same 8 MiB ceiling as one page.
    if ((rendered += bytes(html)) > LIMITS.outputBytes) fail('Combined rendered pages exceed 8 MiB');
    output[definition.entrypoint] = html;
  }
  if (Object.values(output).reduce((total,value) => total + bytes(value),0) > LIMITS.projectBytes) fail('Generated project exceeds 32 MiB');
  return output;
}
