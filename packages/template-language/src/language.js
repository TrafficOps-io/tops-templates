'use strict';

// A tolerant, non-executing authoring model of TemplateSourceParser / TemplateMarkupCompiler.
// Offsets are UTF-16, matching VS Code's TextDocument.offsetAt().
const BUILTIN_TYPES = Object.freeze({
  String: 'Single-line text input.', Text: 'Plain-text textarea.', Color: 'Color picker.',
  Wysiwyg: 'Visual rich-text editor with formatting, links and images. Stores sanitized HTML. Render formatted content with {{& path}} inside an HTML body container; {{path}} escapes the stored string.',
  Markdown: 'Markdown source editor with images and server-rendered preview. Stores Markdown source. Render sanitized HTML with {{& path}} inside an HTML body container; {{path}} escapes the stored string.',
  Number: 'Numeric input.', Range: 'Numeric slider.', Boolean: 'Checkbox.',
  Select: 'Select input; declare choices using options="value:Label|other:Label".',
  Image: 'Image URL, bundled asset path, or uploaded image. Configure cropping with aspect_ratio or exact output sizes with sizes.', Url: 'URL input.', Email: 'Email input.',
});
const FORMATTED_TYPES = new Set(['Wysiwyg', 'Markdown']);
const DIALECTS = Object.freeze({
  SAFE_HTML_V1: 'safe-html-v1',
  FAST_LANDINGS_V1: 'fast-landings-v1',
});
const DEFAULT_DIALECT = DIALECTS.FAST_LANDINGS_V1;
const RUNTIME_SOURCES = Object.freeze(['query', 'headers', 'body']);
const SAFE_RUNTIME_SOURCES = Object.freeze(['query', 'locale', 'actions']);
const DIALECT_PROFILES = Object.freeze({
  [DIALECTS.SAFE_HTML_V1]: Object.freeze({
    id: DIALECTS.SAFE_HTML_V1,
    runtimeSources: SAFE_RUNTIME_SOURCES,
    validation: false,
    php: false,
    wildcards: false,
  }),
  [DIALECTS.FAST_LANDINGS_V1]: Object.freeze({
    id: DIALECTS.FAST_LANDINGS_V1,
    runtimeSources: RUNTIME_SOURCES,
    validation: true,
    php: true,
    wildcards: true,
  }),
});
const RUNTIME_TYPES = Object.freeze({ String: 'Request string.', Number: 'Finite numeric request value.', Integer: 'Integer request value.', Boolean: 'Boolean request value.' });
const COMMON_HEADERS = Object.freeze(['accept', 'accept-language', 'content-type', 'referer', 'user-agent', 'x-forwarded-for', 'x-request-id']);
const RUNTIME_OPTION_DOCS = Object.freeze({
  required: 'Require this request value. Bare required means true.',
  min: 'Minimum string length (Unicode characters) or numeric value.',
  max: 'Maximum string length (Unicode characters) or numeric value.',
  length: 'Exact string length in Unicode characters.',
  lenght: 'Compatibility alias for length; prefer length.',
  mask: 'String mask: each dot matches one digit; all other characters are literal.',
  fallback: 'Local path to redirect to when request validation fails, before rendering the page.',
});
const DIRECTIVES = Object.freeze({
  template: ['Template name, description and DSL version.', '@template "${1:Template name}" description="${2:Description}" version=1'],
  previewData: ['Optional JSON object used to render the template preview. Does not change field defaults; previewUrl takes precedence.', '@previewData\n{\n\t"${1:title}": "${2:Demo}"\n\\}\n@endpreviewData'],
  endpreviewData: ['Close the preview data JSON object.', '@endpreviewData'],
  validation: ['Validate query, headers or body values at request time for this page.', '@validation ${1|query,headers,body|} fallback="${2:/error}"\n\t@param ${3:name} ${4|String,Number,Integer,Boolean|} required\n@endvalidation'],
  endvalidation: ['Close request validation declarations.', '@endvalidation'],
  param: ['Declare a typed setting or record field.', '@param ${1:name} ${2:String} label="${3:Label}"'],
  type: ['Declare an author-defined record type.', '@type ${1:Record}\n\t@param ${2:field} ${3:String}\n@endtype'],
  endtype: ['Close a record type.', '@endtype'],
  section: ['Group settings in a form section; their paths stay at the root.', '@section ${1:content} "${2:Content}"\n\t${0}\n@endsection'],
  endsection: ['Close a settings section.', '@endsection'],
  block: ['Declare a reusable block with typed arguments.', '@block ${1:blockName}(${2:value}: ${3:String})\n\t${0}\n@endblock'],
  endblock: ['Close a reusable block.', '@endblock'],
  layout: ['Declare the page layout.', '@layout\n\t${0}\n@endlayout'],
  endlayout: ['Close the page layout.', '@endlayout'],
  each: ['Iterate over an array of author-defined records.', '@each ${1:item} in ${2:items}:\n\t${0}\n@endeach'],
  endeach: ['Close a loop.', '@endeach'],
  if: ['Render content when a parameter path is truthy; DSL v1 has no @else.', '@if ${1:condition}\n\t${0}\n@endif'],
  endif: ['Close a conditional.', '@endif'],
  unless: ['Render content when a parameter is empty or false, keeping the current scope.', '@unless ${1:condition}\n\t${0}\n@endunless'],
  endunless: ['Close an inverse conditional.', '@endunless'],
  render: ['Render a block with positional, typed parameter paths.', '@render ${1:blockName}(${2:arguments})'],
  include: ['Include a source fragment relative to the template package root.', '@include "${1:blocks/block.tpl}"'],
});
const OPTION_DOCS = Object.freeze({
  label: 'Label shown in the generated settings form.', help: 'Help text below the control.',
  aiInstructions: 'AI instructions for this field or block, stored as template metadata; does not change rendered HTML.',
  required: 'Require a value (true or false).', default: 'Default value; = value is also supported.',
  min: 'Minimum numeric value.', max: 'Maximum numeric value.', step: 'Numeric increment.',
  aspect_ratio: 'Image crop ratio, e.g. 16:9. Use either aspect_ratio or sizes.',
  sizes: 'Image output sizes, e.g. 1200x630|1080x1080 (up to 10, maximum 4096 px per side).',
  options: 'Select choices formatted as value:Label|other:Other label.',
  min_items: 'Minimum number of records; creates initial rows with field defaults.',
  max_items: 'Maximum number of records.', description: 'Template description.', version: 'DSL language version; currently 1.',
  previewUrl: 'Public HTTP(S) page or image used to generate the template preview. Takes precedence over previewData.',
  previewData: 'Optional JSON object with preview-only field values. Does not change field defaults. For larger examples use @previewData … @endpreviewData.',
});
const NAME = '[A-Za-z][A-Za-z0-9_]*';
const PARAM = new RegExp(`^\\s*@param\\s+(${NAME})(?:\\s+(${NAME}(?:\\[\\])?))?`);
const RUNTIME_PATH = '[A-Za-z0-9_][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_][A-Za-z0-9_-]*)*';
const RUNTIME_PARAM = new RegExp(`^\\s*@param\\s+(${RUNTIME_PATH})(?=\\s|$)(?:\\s+(${NAME}))?`);

function normalizeDialect(value) {
  return value === DIALECTS.SAFE_HTML_V1 ? value : DEFAULT_DIALECT;
}

function dialectFrom(options) {
  return normalizeDialect(typeof options === 'string' ? options : options?.dialect);
}

function profileFor(value) {
  return DIALECT_PROFILES[normalizeDialect(value)];
}

// Treat PHP as opaque source: no DSL declarations, macros or formatting inside
// PHP strings/comments/heredocs, even when they contain a literal closing tag.
function phpSpans(text) {
  const spans = [];
  const opening = /<\?(?:php(?=\s|$)|=)/gi;
  let match;
  while ((match = opening.exec(text))) {
    let cursor = opening.lastIndex, quote = null, comment = null, heredoc = null, closed = false;
    while (cursor < text.length) {
      if (heredoc) {
        if ((cursor === 0 || text[cursor - 1] === '\n') && new RegExp(`^[ \\t]*${heredoc}(?![A-Za-z0-9_])`).test(text.slice(cursor))) {
          cursor += text.slice(cursor).match(new RegExp(`^[ \\t]*${heredoc}`))[0].length;
          heredoc = null;
        } else cursor++;
      } else if (quote) {
        if (text[cursor] === '\\') cursor += 2;
        else if (text[cursor++] === quote) quote = null;
      } else if (comment === 'block') {
        if (text.startsWith('*/', cursor)) { cursor += 2; comment = null; } else cursor++;
      } else if (text.startsWith('?>', cursor)) { cursor += 2; closed = true; break;
      } else if (comment === 'line') {
        if (/[\r\n]/.test(text[cursor])) comment = null;
        cursor++;
      } else if (text.startsWith('//', cursor) || (text[cursor] === '#' && text[cursor + 1] !== '[')) { comment = 'line'; cursor++;
      } else if (text.startsWith('/*', cursor)) { comment = 'block'; cursor += 2;
      } else if (/["'`]/.test(text[cursor])) quote = text[cursor++];
      else {
        const here = text.startsWith('<<<', cursor) && /^<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))[ \t]*\r?\n/.exec(text.slice(cursor));
        if (here) { heredoc = here[1] || here[2] || here[3]; cursor += here[0].length; } else cursor++;
      }
    }
    spans.push({ start: match.index, end: cursor, closed });
    opening.lastIndex = cursor;
  }
  return spans;
}

function linesOf(text) {
  const lines = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const raw = match[0];
    if (raw.length === 0 && text.length > 0 && !/[\r\n]$/.test(text)) break;
    lines.push({ start: match.index, end: match.index + raw.length, text: raw.replace(/[\r\n]+$/, '') });
    if (raw.length === 0) break;
  }
  return lines;
}

function optionsOf(text, onDuplicate) {
  const options = Object.create(null);
  const pattern = /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[2];
    if (Object.hasOwn(options, match[1])) onDuplicate?.(match[1]);
    options[match[1]] = /^["']/.test(value) ? value.slice(1, -1).replace(/\\(["'\\])/g, '$1') : value;
  }
  return options;
}

function localFallback(value) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!value || /[\x00-\x20\x7f\\\\]/.test(value) || value.startsWith('//') || /^[^/?#]*:/.test(value)) return false;
    const decoded = value.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (decoded === value) return true;
    value = decoded;
  }
  return false;
}

function declaration(uri, kind, name, type, line, index, options = {}) {
  return { uri, kind, name, type, start: line.start + index, end: line.start + index + name.length,
    bodyStart: line.end, bodyEnd: line.end, lineStart: line.start, lineEnd: line.end, options };
}

function diagnoseSafeRuntime(document) {
  const pattern = /(?<!\{)\{(?:query|headers|body|actions|locale)(?:\.[^{}\r\n]*)?\}(?!\})/g;
  for (const match of document.text.matchAll(pattern)) {
    if (document.text[match.index - 1] === '\\'
      || document.phpSpans.some(span => span.start <= match.index && match.index < span.end)
      || document.previewBlocks.some(block => block.start <= match.index && match.index < block.end)
      || /^\{(?:locale|(?:query|actions)\.[A-Za-z][A-Za-z0-9_-]{0,63})\}$/.test(match[0])) continue;
    document.diagnostics.push({
      start: match.index,
      end: match.index + match[0].length,
      message: 'safe-html-v1 runtime macros support only {query.name}, {locale} and {actions.name}; headers, body, nested paths and wildcards are unavailable.',
    });
  }
}

function parseDocument(uri, text, options = {}) {
  const dialect = dialectFrom(options);
  const profile = profileFor(dialect);
  const document = { uri, text, dialect, lines: linesOf(text), includes: [], types: [], params: [], blocks: [], sections: [], scopes: [], references: [], previewBlocks: [], validationBlocks: [], runtimeParams: [], phpSpans: phpSpans(text), metadata: {}, diagnostics: [] };
  let type = null;
  let section = null;
  let owner = null;
  let previewBlock = null;
  let hasPreviewData = false;
  let validation = null;
  let unsupportedValidation = false;
  const diagnostic = (line, message) => document.diagnostics.push({ start: line.start, end: line.start + line.text.length, message });
  const previewData = (value, line) => {
    if (hasPreviewData) diagnostic(line, 'Declare previewData only once: in @template or in an @previewData block.');
    hasPreviewData = true;
    try {
      const parsed = JSON.parse(value);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('object');
      document.metadata.previewData = parsed;
    } catch {
      diagnostic(line, 'previewData must be a valid JSON object.');
    }
  };
  const scopes = [];
  const closeScopes = (end, kind) => {
    const index = kind ? scopes.map(scope => scope.kind).lastIndexOf(kind) : 0;
    if (index < 0) return;
    for (const scope of scopes.splice(index)) { scope.bodyEnd = end; }
  };
  for (const line of document.lines) {
    if (document.phpSpans.some(span => span.start < line.end && span.end > line.start)) {
      const directiveOffset = line.start + line.text.search(/\S/);
      if (document.phpSpans.some(span => span.start <= directiveOffset && span.end > directiveOffset)) continue;
    }
    const match = /^\s*@([A-Za-z][A-Za-z0-9_-]*)\b(.*)$/.exec(line.text);
    if (previewBlock) {
      if (match?.[1] === 'endpreviewData' && !match[2].trim()) {
        previewBlock.bodyEnd = line.start;
        previewBlock.end = line.end;
        previewBlock.closed = true;
        previewData(text.slice(previewBlock.bodyStart, previewBlock.bodyEnd), previewBlock.line);
        previewBlock = null;
      }
      continue;
    }
    if (!match) continue;
    const [, directive, rest] = match;
    if (!profile.validation) {
      if (directive === 'validation') {
        diagnostic(line, '@validation is unavailable in the safe-html-v1 dialect; the host must select fast-landings-v1 for request validation.');
        unsupportedValidation = true;
        continue;
      }
      if (unsupportedValidation) {
        if (directive === 'endvalidation') unsupportedValidation = false;
        continue;
      }
      if (directive === 'endvalidation') {
        diagnostic(line, '@endvalidation is unavailable in the safe-html-v1 dialect.');
        continue;
      }
    }
    if (directive === 'validation') {
      if (validation) diagnostic(line, 'Close @validation before starting another validation block.');
      if (type || section || owner) diagnostic(line, '@validation must be declared at the top level.');
      const source = /^\s*(\S+)/.exec(rest)?.[1] || '';
      if (!RUNTIME_SOURCES.includes(source)) diagnostic(line, '@validation source must be query, headers or body.');
      const options = optionsOf(rest.slice(source.length + 1));
      if (Object.hasOwn(options, 'fallback') && !localFallback(options.fallback)) diagnostic(line, '@validation fallback must be a local path.');
      validation = { ...declaration(uri, 'validation', source || 'validation', null, line, source ? line.text.indexOf(source, line.text.indexOf('@validation') + 11) : line.text.indexOf('@validation') + 1, options), source, fallback: options.fallback, params: [], bodyEnd: text.length, closed: false, line };
      document.validationBlocks.push(validation);
      continue;
    }
    if (directive === 'endvalidation') {
      if (!validation) diagnostic(line, '@endvalidation has no matching @validation.');
      else { validation.bodyEnd = line.start; validation.lineEnd = line.end; validation.closed = true; validation = null; }
      continue;
    }
    if (validation) {
      if (directive !== 'param') { diagnostic(line, 'Only @param declarations are allowed inside @validation.'); continue; }
      const parameter = RUNTIME_PARAM.exec(line.text);
      if (!parameter) { diagnostic(line, 'Declare a request parameter name and type.'); continue; }
      const options = optionsOf(line.text.slice(parameter[0].length));
      if (/(?:^|\s)required(?:\s|$)/.test(line.text.slice(parameter[0].length))) options.required = 'true';
      if (Object.hasOwn(options, 'lenght') && !Object.hasOwn(options, 'length')) options.length = options.lenght;
      const nameIndex = line.text.indexOf(parameter[1], line.text.indexOf('@param') + 6);
      const param = { ...declaration(uri, 'runtime', parameter[1], parameter[2] || '', line, nameIndex, options), source: validation.source };
      if (!(param.type in RUNTIME_TYPES)) diagnostic(line, 'Request parameters support String, Number, Integer and Boolean.');
      if (validation.params.some(item => validation.source === 'headers' ? item.name.toLowerCase() === param.name.toLowerCase() : item.name === param.name)) diagnostic(line, `Duplicate request parameter ${param.name}.`);
      for (const name of Object.keys(options)) if (!(name in RUNTIME_OPTION_DOCS)) diagnostic(line, `Unknown request validation option ${name}.`);
      if (param.type !== 'String' && (Object.hasOwn(options, 'mask') || Object.hasOwn(options, 'length'))) diagnostic(line, 'length and mask only apply to String request parameters.');
      if (parameter[2]) {
        const start = line.start + line.text.indexOf(parameter[2], nameIndex + parameter[1].length);
        document.references.push({ kind: 'runtimeType', name: parameter[2], start, end: start + parameter[2].length });
      }
      validation.params.push(param);
      document.runtimeParams.push(param);
      continue;
    }
    if (directive === 'previewData') {
      if (rest.trim()) diagnostic(line, '@previewData takes its JSON object on the following lines.');
      if (type || section || owner) diagnostic(line, '@previewData must be declared at the top level.');
      previewBlock = { start: line.start, bodyStart: line.end, bodyEnd: text.length, end: text.length, closed: false, line };
      document.previewBlocks.push(previewBlock);
    } else if (directive === 'endpreviewData') {
      diagnostic(line, '@endpreviewData has no matching @previewData.');
    } else if (directive === 'template') {
      const header = /^\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(.*)$/.exec(rest);
      const options = optionsOf(header?.[1] || '', name => {
        if (['previewData', 'previewUrl'].includes(name)) diagnostic(line, `Declare ${name} only once.`);
      });
      if (Object.hasOwn(options, 'previewData')) previewData(options.previewData, line);
      if (Object.hasOwn(options, 'previewUrl')) {
        document.metadata.previewUrl = options.previewUrl;
        try {
          const url = new URL(options.previewUrl);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('URL');
        } catch {
          diagnostic(line, 'previewUrl must be an HTTP(S) URL without credentials, using port 80 or 443.');
        }
      }
    } else if (directive === 'include') {
      const path = /^\s*(["'])(.*?)\1/.exec(rest);
      if (path) {
        const start = line.start + line.text.indexOf(path[1]) + 1;
        document.includes.push({ path: path[2], start, end: start + path[2].length });
      }
    } else if (directive === 'type') {
      const name = /^\s*([A-Z][A-Za-z0-9_]*)/.exec(rest)?.[1];
      if (!name) continue;
      if (type) type.bodyEnd = line.start;
      type = declaration(uri, 'type', name, name, line, line.text.indexOf(name, line.text.indexOf('@type') + 5));
      type.fields = [];
      type.bodyEnd = text.length;
      document.types.push(type);
    } else if (directive === 'endtype') {
      if (type) type.bodyEnd = line.end;
      type = null;
    } else if (directive === 'section') {
      const name = /^\s*([A-Za-z][A-Za-z0-9_]*)/.exec(rest)?.[1];
      if (!name) continue;
      if (section) section.bodyEnd = line.start;
      section = declaration(uri, 'section', name, null, line, line.text.indexOf(name, line.text.indexOf('@section') + 8));
      section.params = [];
      section.bodyEnd = text.length;
      document.sections.push(section);
    } else if (directive === 'endsection') {
      if (section) section.bodyEnd = line.end;
      section = null;
    } else if (directive === 'param') {
      const parameter = PARAM.exec(line.text);
      if (!parameter) continue;
      const nameIndex = line.text.indexOf(parameter[1], line.text.indexOf('@param') + 6);
      const param = declaration(uri, type ? 'field' : 'variable', parameter[1], parameter[2] || '', line, nameIndex, optionsOf(line.text.slice(parameter[0].length)));
      if (parameter[2]) {
        const typeIndex = line.text.indexOf(parameter[2], nameIndex + parameter[1].length);
        document.references.push({ kind: 'type', name: parameter[2].replace(/\[\]$/, ''), start: line.start + typeIndex, end: line.start + typeIndex + parameter[2].replace(/\[\]$/, '').length });
      }
      if (type) type.fields.push(param);
      else if (!owner) { document.params.push(param); if (section) section.params.push(param); }
    } else if (directive === 'block' || directive === 'layout') {
      closeScopes(line.start);
      if (owner) owner.bodyEnd = line.start;
      type = null;
      const signature = directive === 'block' ? /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\((.*))?$/.exec(rest) : null;
      if (directive === 'block' && !signature) continue;
      const name = signature ? signature[1] : 'layout';
      owner = declaration(uri, directive, name, null, line, directive === 'block' ? line.text.indexOf(name, line.text.indexOf('@block') + 6) : line.text.indexOf('@layout') + 1);
      owner.args = [];
      owner.bodyEnd = text.length;
      if (signature?.[2] !== undefined) {
        const argumentStart = line.text.indexOf('(') + 1;
        const argumentEnd = line.text.indexOf(')', argumentStart);
        const argumentText = line.text.slice(argumentStart, argumentEnd < 0 ? undefined : argumentEnd);
        if (argumentEnd >= 0) owner.options = optionsOf(line.text.slice(argumentEnd + 1));
        for (const argument of argumentText.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*([A-Za-z][A-Za-z0-9_]*(?:\[\])?)?/g)) {
          const index = argumentStart + argument.index + argument[0].indexOf(argument[1]);
          const arg = declaration(uri, 'variable', argument[1], argument[2] || '', line, index);
          owner.args.push(arg);
          if (argument[2]) {
            const start = line.start + argumentStart + argument.index + argument[0].lastIndexOf(argument[2]);
            document.references.push({ kind: 'type', name: argument[2].replace(/\[\]$/, ''), start, end: start + argument[2].replace(/\[\]$/, '').length });
          }
        }
      }
      document.scopes.push(owner);
      scopes.push(owner);
      if (directive === 'block') document.blocks.push(owner);
    } else if (directive === 'endblock' || directive === 'endlayout') {
      closeScopes(line.start);
      if (owner) owner.bodyEnd = line.start;
      owner = null;
    } else if (directive === 'each' && owner) {
      const loop = /^\s*([A-Za-z][A-Za-z0-9_]*)\s+in\s+([A-Za-z][A-Za-z0-9_.]*)/.exec(rest);
      if (!loop) continue;
      const scope = declaration(uri, 'each', loop[1], null, line, line.text.indexOf(loop[1], line.text.indexOf('@each') + 5));
      scope.path = loop[2];
      scope.bodyEnd = text.length;
      scope.owner = owner;
      document.scopes.push(scope);
      scopes.push(scope);
    } else if (directive === 'endeach') closeScopes(line.start, 'each');
  }
  if (previewBlock) diagnostic(previewBlock.line, 'Close @previewData with @endpreviewData.');
  if (validation) diagnostic(validation.line, 'Close @validation with @endvalidation.');
  if (!profile.php) {
    const sourcePath = uri.replace(/[?#].*$/, '');
    if (/\.tpl\.php$/i.test(sourcePath)) {
      document.diagnostics.push({ start: 0, end: document.lines[0]?.text.length || 0, message: '.tpl.php sources are unavailable in the safe-html-v1 dialect; use a non-executable template source.' });
    } else if (/\.(?:php\d*|phtml|phar|blade(?:\.php)?|cgi|pl|py|rb|sh|asp|aspx|jsp)(?:\.|$)/i.test(sourcePath)) {
      document.diagnostics.push({ start: 0, end: document.lines[0]?.text.length || 0, message: 'Executable source paths are unavailable in the safe-html-v1 dialect; use a non-executable template source.' });
    }
    for (const span of document.phpSpans) {
      const openingLength = text.startsWith('<?=', span.start) ? 3 : 5;
      document.diagnostics.push({ start: span.start, end: Math.min(text.length, span.start + openingLength), message: 'PHP source is unavailable in the safe-html-v1 dialect.' });
    }
    for (const opening of text.matchAll(/<\?/g)) {
      if (document.phpSpans.some(span => span.start === opening.index)) continue;
      document.diagnostics.push({ start: opening.index, end: opening.index + 2, message: 'Executable PHP-style source is unavailable in the safe-html-v1 dialect.' });
    }
    diagnoseSafeRuntime(document);
  }
  return document;
}

function buildProject(documents, options = {}) {
  const customTypes = Array.isArray(options?.customTypes) ? options.customTypes : [];
  const dialect = dialectFrom(options);
  const project = { dialect, documents: new Map(), types: new Map(), params: new Map(), blocks: new Map(), customTypes: new Set(customTypes.filter(type => /^[A-Z][A-Za-z0-9_]*$/.test(type))) };
  for (const input of documents) {
    const document = parseDocument(input.uri, input.text, { dialect });
    project.documents.set(document.uri, document);
    for (const type of document.types) if (!project.types.has(type.name)) project.types.set(type.name, type);
    for (const param of document.params) if (!project.params.has(param.name)) project.params.set(param.name, param);
    for (const block of document.blocks) if (!project.blocks.has(block.name)) project.blocks.set(block.name, block);
  }
  return project;
}

/** Runtime declarations stay page-local even when a project contains companion pages. */
function getRuntimeMacros(project, uri) {
  const selected = new Set();
  const targetsFor = document => document.includes.flatMap(include => {
    const path = include.path.replace(/\\/g, '/');
    const matches = [...project.documents.values()].filter(candidate => {
      try { return decodeURIComponent(candidate.uri).endsWith(`/${path}`); } catch { return candidate.uri.endsWith(`/${path}`); }
    });
    return matches.length === 1 ? matches : [];
  });
  const visit = document => {
    if (!document || selected.has(document)) return;
    selected.add(document);
    for (const target of targetsFor(document)) visit(target);
  };
  if (uri !== undefined) {
    let document = project.documents.get(uri);
    const ancestors = new Set();
    // An included fragment can see its unambiguous owning page's rules. A
    // shared fragment with multiple owning pages must not mix their scopes.
    while (document && !ancestors.has(document)) {
      ancestors.add(document);
      const parents = [...project.documents.values()].filter(candidate => targetsFor(candidate).includes(document));
      if (parents.length !== 1 || ancestors.has(parents[0])) break;
      document = parents[0];
    }
    visit(document);
  }
  else for (const document of project.documents.values()) selected.add(document);
  const macros = new Map();
  for (const document of selected) for (const param of document.runtimeParams) {
    const path = param.source === 'headers' ? param.name.toLowerCase() : param.name;
    const name = `${param.source}.${path}`;
    if (!macros.has(name)) macros.set(name, { ...param, name, path });
  }
  return [...macros.values()];
}

function inPhp(document, offset) {
  return document.phpSpans.some(span => span.start <= offset && (offset < span.end || (!span.closed && offset === span.end)));
}
function validationAt(document, offset) {
  return document.validationBlocks.find(block => block.bodyStart <= offset && (offset < block.bodyEnd || (!block.closed && offset === document.text.length)));
}
function runtimeContext(document, offset) {
  if (inPreviewData(document, offset) || inPhp(document, offset)) return null;
  const profile = profileFor(document.dialect);
  const line = lineAt(document, offset), prefix = line.text.slice(0, offset - line.start);
  const opening = prefix.lastIndexOf('{');
  if (opening < 0 || /[\\{]/.test(prefix[opening - 1] || '') || line.text[opening + 1] === '{') return null;
  const expression = prefix.slice(opening + 1);
  if (!/^[A-Za-z0-9_.*-]*$/.test(expression)) return null;
  const source = expression.split('.')[0];
  if (!profile.runtimeSources.some(name => expression.includes('.') ? name === source : name.startsWith(source))) return null;
  let end = offset;
  while (end < document.text.length && /[A-Za-z0-9_.*-]/.test(document.text[end])) end++;
  return { start: line.start + opening + 1, end, expression };
}
function runtimeCompletions(project, document, context, offset) {
  const profile = profileFor(project.dialect || document.dialect);
  const { expression } = context;
  const dot = expression.lastIndexOf('.');
  const range = { start: context.start + dot + 1, end: context.end };
  if (dot < 0) return profile.runtimeSources.filter(source => source.startsWith(expression)).map(source => {
    if (profile.id === DIALECTS.SAFE_HTML_V1) {
      const scalar = source === 'locale';
      return { label: source, insertText: scalar ? source : `${source}.`, kind: 'variable', detail: scalar ? 'Host-supplied locale' : `Host-supplied ${source} value`, documentation: scalar ? 'The locale selected by the host application.' : `A scalar ${source} value explicitly supplied by the host application.`, range };
    }
    return { label: source, insertText: `${source}.`, kind: 'variable', detail: 'Runtime request source', documentation: `Request-time ${source} values. Use {${source}.*} for the complete source as JSON.`, range };
  });
  const parent = expression.slice(0, dot + 1), partial = expression.slice(dot + 1);
  const source = expression.split('.')[0];
  if (profile.id === DIALECTS.SAFE_HTML_V1) {
    if (!['query', 'actions'].includes(source) || dot !== source.length || !'name'.startsWith(partial)) return [];
    return [{ label: 'name', kind: 'field', detail: `Host-supplied ${source} key`, documentation: `Replace name with a ${source} identifier exposed by the host application.`, range }];
  }
  const macros = getRuntimeMacros(project, document.uri);
  if (source === 'headers') for (const name of COMMON_HEADERS) if (!macros.some(item => item.name === `headers.${name}`)) macros.push({ name: `headers.${name}`, type: 'String', options: {}, source: 'headers' });
  const items = new Map();
  if (dot === source.length && '*'.startsWith(partial)) items.set('*', { label: '*', kind: 'field', detail: 'Complete request source as JSON', documentation: `{${source}.*} serializes the complete ${source} object.`, range });
  for (const macro of macros) {
    const name = source === 'headers' ? macro.name.toLowerCase() : macro.name;
    const prefix = source === 'headers' ? parent.toLowerCase() : parent;
    if (!name.startsWith(prefix)) continue;
    const remainder = name.slice(parent.length), segment = remainder.split('.')[0];
    if (!segment.startsWith(source === 'headers' ? partial.toLowerCase() : partial) || items.has(segment)) continue;
    const nested = remainder.includes('.');
    items.set(segment, { label: segment, kind: 'field', detail: nested ? `${parent}${segment}: request object` : `${macro.name}: ${macro.type}`, documentation: docsFor(macro), range });
  }
  return [...items.values()];
}

function runtimeOptionCompletions(type, prefix, range, context = 'param') {
  if (inQuote(prefix)) return [];
  if (/(?:^|\s)required\s*=\s*(?:t|tr|tru|true|f|fa|fal|fals|false)?$/.test(prefix)) return ['true', 'false'].map(label => ({ label, kind: 'keyword', detail: 'Boolean value', range }));
  if (/(?:^|\s)(?:\w+\s*)?=\s*[^\s]*$/.test(prefix)) return [];
  const allowed = context === 'validation' ? ['fallback'] : ['required'];
  if (context === 'param' && ['String', 'Number', 'Integer'].includes(type)) allowed.push('min', 'max');
  if (context === 'param' && type === 'String') allowed.push('length', 'mask');
  const used = optionsOf(prefix);
  if (/(?:^|\s)required(?:\s|$)/.test(prefix)) used.required = true;
  if (Object.hasOwn(used, 'lenght')) used.length = used.lenght;
  const values = { fallback: '"${1:/error}"', min: '${1:0}', max: '${1:100}', length: '${1:10}', mask: '"${1:+380 ... ... ...}"' };
  return allowed.filter(name => !Object.hasOwn(used, name)).map(name => ({ label: name, kind: 'property', detail: RUNTIME_OPTION_DOCS[name], documentation: RUNTIME_OPTION_DOCS[name], insertText: name === 'required' ? name : `${name}=${values[name]}`, snippet: name !== 'required', range }));
}

function lineAt(document, offset) {
  let low = 0, high = document.lines.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (document.lines[mid].start <= offset) low = mid; else high = mid - 1;
  }
  return document.lines[low];
}
function scopeAt(project, document, offset) {
  const variables = new Map(project.params);
  const scopes = document.scopes.filter(scope => scope.bodyStart <= offset && (offset < scope.bodyEnd || (offset === document.text.length && scope.bodyEnd === document.text.length)));
  for (const scope of scopes) {
    if (scope.kind === 'block') for (const arg of scope.args) variables.set(arg.name, arg);
    else if (scope.kind === 'each') {
      const source = resolvePath(project, variables, scope.path);
      variables.set(scope.name, { ...scope, kind: 'variable', type: source?.type.endsWith('[]') ? source.type.slice(0, -2) : '' });
    }
  }
  return variables;
}
function resolvePath(project, variables, path) {
  const segments = path.split('.');
  let symbol = variables.get(segments.shift());
  for (const segment of segments) {
    if (!symbol || symbol.type.endsWith('[]')) return null;
    symbol = project.types.get(symbol.type)?.fields.find(field => field.name === segment);
  }
  return symbol || null;
}
function wordRange(document, offset) {
  let start = offset, end = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(document.text[start - 1])) start--;
  while (end < document.text.length && /[A-Za-z0-9_]/.test(document.text[end])) end++;
  return { start, end };
}
function inQuote(text) {
  let quote = null, escaped = false;
  for (const character of text) {
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; }
    else if (character === '"' || character === "'") quote = character;
  }
  return quote !== null;
}
function renderContext(line, column) {
  const match = /^\s*@render\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/.exec(line.text);
  if (!match || column < match[0].length) return null;
  const prefix = line.text.slice(match[0].length, column);
  if (prefix.includes(')') || /["']/.test(prefix)) return null;
  return { name: match[1], activeParameter: (prefix.match(/,/g) || []).length,
    start: line.start + match[0].length + prefix.lastIndexOf(',') + 1 };
}
function inPreviewData(document, offset) {
  return document.previewBlocks.some(block => block.bodyStart <= offset && (offset < block.bodyEnd || (!block.closed && offset === document.text.length)));
}
function expressionContext(document, offset) {
  if (inPreviewData(document, offset) || inPhp(document, offset)) return null;
  const line = lineAt(document, offset);
  const column = offset - line.start;
  const prefix = line.text.slice(0, column);
  // Ordinary interpolation also works in attributes and script/style strings.
  // Formatted interpolation belongs in HTML body containers; the server validates placement.
  if (!/^\s*@(param|type|block|section|template|include)\b/.test(line.text)) {
    const opening = prefix.lastIndexOf('{{');
    const expression = /^(\s*&\s*)?[\sA-Za-z0-9_.]*$/.exec(prefix.slice(opening + 2));
    if (opening >= 0 && prefix[opening - 1] !== '{' && expression) {
      return { start: line.start + opening + 2 + (expression[1]?.length || 0), end: line.start + (line.text.indexOf('}}', opening + 2) >= 0 ? line.text.indexOf('}}', opening + 2) : line.text.length), mode: expression[1] ? 'formatted' : 'interpolation' };
    }
  }
  let match = /^\s*@(?:if|unless)\s+/.exec(line.text);
  if (match && column >= match[0].length) return { start: line.start + match[0].length, end: line.start + line.text.length, mode: 'if' };
  match = /^\s*@each\s+[A-Za-z][A-Za-z0-9_]*\s+in\s+/.exec(line.text);
  if (match && column >= match[0].length && !prefix.slice(match[0].length).includes(':')) return { start: line.start + match[0].length, end: line.start + line.text.length, mode: 'each' };
  const render = renderContext(line, column);
  if (render) return { ...render, end: line.start + line.text.length, mode: 'render' };
  return null;
}
function docsFor(symbol) {
  if (symbol.kind === 'runtime' || symbol.source) {
    const rules = Object.entries(symbol.options || {}).filter(([name]) => name !== 'lenght').map(([name, value]) => `${name}=${value}`).join(', ');
    return `Request-time ${symbol.source} value${symbol.uri ? ', validated before this page is rendered' : ''}.${rules ? `\n\nValidation: ${rules}.` : ''}`;
  }
  const instructions = symbol.options?.aiInstructions;
  const text = [symbol.options?.label, symbol.options?.help, instructions ? `AI instructions: ${instructions}` : '', FORMATTED_TYPES.has(symbol.type) ? BUILTIN_TYPES[symbol.type] : ''].filter(Boolean).join('\n\n');
  return text || (symbol.kind === 'block' ? 'Reusable template block.' : symbol.kind === 'field' ? 'Field of an author-defined record.' : 'Template parameter.');
}
function typeCompletions(project, range) {
  const result = [];
  for (const [name, description] of Object.entries(BUILTIN_TYPES)) result.push({ label: name, kind: 'type', detail: 'Built-in field type', documentation: description, range });
  for (const name of project.customTypes) if (!(name in BUILTIN_TYPES)) result.push({ label: name, kind: 'type', detail: 'Application-registered field type', range });
  for (const type of project.types.values()) {
    result.push({ label: type.name, kind: 'type', detail: 'Author-defined record', documentation: type.fields.map(field => `${field.name}: ${field.type}`).join('\n'), range });
    result.push({ label: `${type.name}[]`, kind: 'type', detail: 'Repeatable record group', range });
  }
  return result;
}
function optionCompletions(type, prefix, range, project, context = 'param') {
  if (inQuote(prefix)) return [];
  const booleanValue = /(?:^|\s)(required|default)\s*=\s*(?:t|tr|tru|true|f|fa|fal|fals|false)?$/.exec(prefix);
  if ((booleanValue && (booleanValue[1] === 'required' || type === 'Boolean')) || (type === 'Boolean' && /(?:^|\s)=\s*(?:t|tr|tru|true|f|fa|fal|fals|false)?$/.test(prefix))) {
    return ['true', 'false'].map(label => ({ label, kind: 'keyword', detail: 'Boolean value', range }));
  }
  if (/(?:^|\s)(?:\w+\s*)?=\s*[^\s]*$/.test(prefix)) return [];
  const allowed = context === 'template' ? ['description', 'version', 'previewUrl', 'previewData'] : context === 'block' ? ['aiInstructions'] : ['label', 'help', 'aiInstructions', 'required'];
  if (context === 'param' && !project.types.has(type) && !type.endsWith('[]')) allowed.push('default');
  if (['Number', 'Range'].includes(type)) allowed.push('min', 'max', 'step');
  if (type === 'Select') allowed.push('options');
  if (type.endsWith('[]') && project.types.has(type.slice(0, -2))) allowed.push('min_items', 'max_items');
  const used = optionsOf(prefix);
  if (type === 'Image' && !Object.hasOwn(used, 'sizes') && !Object.hasOwn(used, 'aspect_ratio')) allowed.push('aspect_ratio', 'sizes');
  if (/(?:^|\s)=\s*/.test(prefix)) used.default = true;
  const values = { aiInstructions: '"${1:Instructions for AI}"', aspect_ratio: '"${1:16:9}"', sizes: '"${1:1200x630}|${2:1080x1080}"', label: '"${1:Label}"', help: '"${1:Help text}"', required: '${1|true,false|}', default: type === 'Boolean' ? '${1|true,false|}' : ['Number', 'Range'].includes(type) ? '${1:0}' : '"${1:value}"', options: '"${1:value}:${2:Label}|${3:other}:${4:Other label}"', min: '${1:0}', max: '${1:100}', step: '${1:1}', min_items: '${1:1}', max_items: '${1:20}', description: '"${1:Description}"', version: '1' };
  values.previewUrl = '"${1:https://example.com/demo}"';
  values.previewData = '\'{"title": "${1:Demo}"\\}\'';
  return allowed.filter(name => !Object.hasOwn(used, name)).map(name => ({ label: name, kind: 'property', detail: OPTION_DOCS[name], documentation: OPTION_DOCS[name], insertText: `${name}=${values[name]}`, snippet: true, range }));
}
function hasReachableType(project, symbolType, expected, mode, visited = new Set()) {
  if (mode === 'each' && symbolType.endsWith('[]')) return true;
  if (expected && symbolType === expected) return true;
  // Alias-to-control mappings live in Laravel, so configured primitive aliases stay eligible.
  if (mode === 'formatted' && (FORMATTED_TYPES.has(symbolType) || (project.customTypes.has(symbolType) && !project.types.has(symbolType)))) return true;
  if (visited.has(symbolType) || visited.size > 256 || symbolType.endsWith('[]')) return false;
  visited.add(symbolType);
  return (project.types.get(symbolType)?.fields || []).some(field => hasReachableType(project, field.type, expected, mode, visited));
}
function getCompletions(project, uri, offset) {
  const document = project.documents.get(uri);
  if (!document) return [];
  const profile = profileFor(project.dialect || document.dialect);
  offset = Math.max(0, Math.min(offset, document.text.length));
  if (inPreviewData(document, offset) || inPhp(document, offset)) return [];
  const line = lineAt(document, offset), prefix = line.text.slice(0, offset - line.start);
  let range = wordRange(document, offset);
  const runtime = runtimeContext(document, offset);
  if (runtime) return runtimeCompletions(project, document, runtime, offset);
  const validation = validationAt(document, offset);
  const source = /^\s*@validation\s+([A-Za-z]*)$/.exec(prefix);
  if (profile.validation && source) return RUNTIME_SOURCES.filter(name => name.startsWith(source[1])).map(label => ({ label, kind: 'variable', detail: 'Runtime request source', range }));
  const validationHeader = profile.validation && /^\s*@validation\s+(?:query|headers|body)\s+(.*)$/.exec(prefix);
  const requestType = profile.validation && validation && new RegExp(`^\\s*@param\\s+${RUNTIME_PATH}\\s+[A-Za-z]*$`).test(prefix);
  if (requestType) return Object.entries(RUNTIME_TYPES).map(([label, documentation]) => ({ label, kind: 'type', detail: 'Runtime validation type', documentation, range }));
  const requestParam = validation && new RegExp(`^\\s*@param\\s+${RUNTIME_PATH}\\s+(${NAME})\\s+(.*)$`).exec(prefix);
  if (validationHeader || requestParam) {
    const items = runtimeOptionCompletions(requestParam?.[1] || '', requestParam?.[2] ?? validationHeader[1], range, requestParam ? 'param' : 'validation');
    if (/^[ \t]*=/.test(document.text.slice(range.end))) for (const item of items) { item.insertText = item.label; item.snippet = false; }
    return items;
  }
  const directive = /^\s*(@[A-Za-z]*)?$/.exec(prefix);
  if (directive) {
    // A cursor inside a CSS at-rule or escaped at-sign is not a DSL keyword.
    if (/^\s*(?:@@|@(?:media|supports|font-face|keyframes|import|layer|container|charset|page|property|starting-style|namespace|scope|counter-style)\b)/.test(line.text)) return [];
    const start = directive[1] ? line.start + prefix.indexOf('@') : offset;
    range = { start, end: range.end };
    const hasArguments = line.text.slice(range.end - line.start).trim().length > 0;
    return Object.entries(DIRECTIVES).filter(([name]) => (profile.validation || !['validation', 'endvalidation'].includes(name)) && (!validation || ['param', 'endvalidation'].includes(name)) && (!directive[1] || name.startsWith(directive[1].slice(1)))).map(([name, [documentation, snippetText]]) => {
      if (validation && name === 'param') snippetText = '@param ${1:name} ${2|String,Number,Integer,Boolean|} required';
      const insertText = hasArguments ? `@${name}` : snippetText;
      return { label: `@${name}`, kind: 'keyword', detail: documentation, documentation, insertText, snippet: insertText.includes('$'), range };
    });
  }
  if (/^\s*@param\s+[A-Za-z][A-Za-z0-9_]*\s+[A-Za-z0-9_\[\]]*$/.test(prefix) || /^\s*@block\s+[A-Za-z][A-Za-z0-9_]*\s*\([^)]*(?:^|[,\s])[A-Za-z][A-Za-z0-9_]*\s*:\s*[A-Za-z0-9_\[\]]*$/.test(prefix) || /^\s*@block\s+[A-Za-z][A-Za-z0-9_]*\s*\([A-Za-z][A-Za-z0-9_]*\s*:\s*[A-Za-z0-9_\[\]]*$/.test(prefix)) {
    while (range.end < document.text.length && /[\[\]]/.test(document.text[range.end])) range.end++;
    while (range.start > line.start && /[A-Za-z0-9_\[\]]/.test(document.text[range.start - 1])) range.start--;
    return typeCompletions(project, range);
  }
  const parameter = /^\s*@param\s+[A-Za-z][A-Za-z0-9_]*\s+([A-Za-z][A-Za-z0-9_]*(?:\[\])?)\s+(.*)$/.exec(prefix);
  const block = /^\s*@block\s+[A-Za-z][A-Za-z0-9_]*\s*\([^)]*\)\s+(.*)$/.exec(prefix);
  if (parameter || block) {
    const items = optionCompletions(parameter?.[1] || '', parameter?.[2] ?? block[1], range, project, parameter ? 'param' : 'block');
    // Editing an existing option name should preserve its assignment and value.
    if (/^[ \t]*=/.test(document.text.slice(range.end))) {
      for (const item of items) { item.insertText = item.label; item.snippet = false; }
    }
    return items;
  }
  const template = /^\s*@template\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s+(.*)$/.exec(prefix);
  if (template) {
    const items = optionCompletions('', template[1], range, project, 'template').filter(item => item.label !== 'previewData' || !document.previewBlocks.length);
    if (/^[ \t]*=/.test(document.text.slice(range.end))) {
      for (const item of items) { item.insertText = item.label; item.snippet = false; }
    }
    return items;
  }
  const blockName = /^\s*@render\s+([A-Za-z0-9_]*)$/.exec(prefix);
  if (blockName) return [...project.blocks.values()].map(block => ({ label: block.name, kind: 'function', detail: signature(block), documentation: docsFor(block), range }));
  const context = expressionContext(document, offset);
  if (!context) return [];
  const expression = document.text.slice(context.start, offset).trimStart();
  if (!/^(?:[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]*)*)?$/.test(expression)) return [];
  const variables = scopeAt(project, document, offset);
  const dot = expression.lastIndexOf('.');
  const expected = context.mode === 'render' ? project.blocks.get(context.name)?.args[context.activeParameter]?.type : undefined;
  let symbols = [...variables.values()];
  if (dot >= 0) {
    const parent = resolvePath(project, variables, expression.slice(0, dot));
    symbols = parent && !parent.type.endsWith('[]') ? project.types.get(parent.type)?.fields || [] : [];
  }
  return symbols.filter(symbol => {
    if (context.mode === 'each' || context.mode === 'formatted' || expected) return hasReachableType(project, symbol.type, expected, context.mode);
    return context.mode !== 'if' || !symbol.type.endsWith('[]');
  }).map(symbol => ({ label: symbol.name, kind: dot >= 0 ? 'field' : 'variable', detail: `${symbol.name}: ${symbol.type}`, documentation: docsFor(symbol), range }));
}
function signature(block) { return `${block.name}(${block.args.map(arg => `${arg.name}: ${arg.type}`).join(', ')})`; }
function getSignatureHelp(project, uri, offset) {
  const document = project.documents.get(uri);
  if (!document || inPreviewData(document, offset) || inPhp(document, offset)) return null;
  const line = lineAt(document, offset), context = renderContext(line, offset - line.start);
  const block = context && project.blocks.get(context.name);
  if (!block) return null;
  return { label: signature(block), parameters: block.args.map(arg => ({ label: `${arg.name}: ${arg.type}`, documentation: docsFor(arg) })), activeParameter: context.activeParameter };
}
function symbolAt(project, document, offset) {
  if (inPhp(document, offset)) return null;
  const runtime = runtimeContext(document, offset);
  if (runtime) {
    const path = document.text.slice(runtime.start, runtime.end);
    const source = path.split('.')[0];
    const symbol = getRuntimeMacros(project, document.uri).find(item => source === 'headers' ? item.name.toLowerCase() === path.toLowerCase() : item.name === path);
    if (symbol) return { symbol, range: { start: runtime.start, end: runtime.end } };
    if (profileFor(project.dialect || document.dialect).runtimeSources.includes(source)) {
      const type = source === 'locale' ? 'String' : path === source || path.endsWith('.*') ? 'Object' : 'runtime value';
      return { symbol: { name: path, kind: 'runtime', source, type, options: {} }, range: { start: runtime.start, end: runtime.end } };
    }
  }
  const declarations = [...document.types, ...document.params, ...document.blocks, ...document.sections, ...document.runtimeParams,
    ...document.types.flatMap(type => type.fields), ...document.blocks.flatMap(block => block.args), ...document.scopes.filter(scope => scope.kind === 'each')];
  const direct = declarations.find(symbol => symbol.start <= offset && offset < symbol.end);
  if (direct) return { symbol: direct, range: { start: direct.start, end: direct.end } };
  const reference = document.references.find(ref => ref.start <= offset && offset <= ref.end);
  if (reference) {
    const symbol = reference.kind === 'runtimeType' ? { name: reference.name, kind: 'type', type: reference.name, runtimeType: true } : project.types.get(reference.name) || { name: reference.name, kind: 'type', type: reference.name, builtin: true };
    return { symbol, range: { start: reference.start, end: reference.end } };
  }
  const line = lineAt(document, offset);
  const render = /^\s*@render\s+([A-Za-z][A-Za-z0-9_]*)/.exec(line.text);
  if (render) {
    const start = line.start + line.text.indexOf(render[1], line.text.indexOf('@render') + 7);
    if (start <= offset && offset <= start + render[1].length) {
      const symbol = project.blocks.get(render[1]);
      if (symbol) return { symbol, range: { start, end: start + render[1].length } };
    }
  }
  const context = expressionContext(document, offset);
  if (!context) return null;
  const range = wordRange(document, offset);
  if (range.start < context.start) return null;
  const path = document.text.slice(context.start, range.end).trimStart();
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path)) return null;
  const symbol = resolvePath(project, scopeAt(project, document, offset), path);
  return symbol ? { symbol, range } : null;
}
function getDefinition(project, uri, offset) {
  const document = project.documents.get(uri);
  if (!document) return null;
  const include = document.includes.find(item => item.start <= offset && offset <= item.end);
  if (include) {
    // Project sources are restricted by the adapter to the package's reachable includes.
    const path = include.path.replace(/\\/g, '/');
    const matches = [...project.documents.keys()].filter(candidate => { try { return decodeURIComponent(candidate).endsWith(`/${path}`); } catch { return candidate.endsWith(`/${path}`); } });
    if (matches.length === 1) return { uri: matches[0], start: 0, end: 0 };
  }
  const result = symbolAt(project, document, offset);
  if (!result || !result.symbol.uri) return null;
  return { uri: result.symbol.uri, start: result.symbol.start, end: result.symbol.end };
}
function getHover(project, uri, offset) {
  const document = project.documents.get(uri);
  if (!document || inPreviewData(document, offset) || inPhp(document, offset)) return null;
  const result = symbolAt(project, document, offset);
  if (result) {
    const symbol = result.symbol;
    let contents;
    if (symbol.kind === 'block') contents = `\`@block ${signature(symbol)}\`\n\n${docsFor(symbol)}`;
    else if (symbol.kind === 'type') contents = `\`${symbol.name}\`\n\n${(symbol.runtimeType ? RUNTIME_TYPES[symbol.name] : BUILTIN_TYPES[symbol.name]) || (symbol.fields ? symbol.fields.map(field => `- \`${field.name}: ${field.type}\``).join('\n') : project.customTypes.has(symbol.name) ? 'Application-registered field type.' : 'Unknown field type. Declare it with @type or configure an application-registered alias.')}`;
    else contents = `\`${symbol.name}: ${symbol.type || 'unknown'}\`\n\n${docsFor(symbol)}`;
    return { contents, range: result.range };
  }
  const line = lineAt(document, offset), directive = /^\s*@([A-Za-z]+)/.exec(line.text);
  const profile = profileFor(project.dialect || document.dialect);
  if (directive && DIRECTIVES[directive[1]] && (profile.validation || !['validation', 'endvalidation'].includes(directive[1]))) {
    const start = line.start + line.text.indexOf('@');
    if (start <= offset && offset <= start + directive[1].length + 1) return { contents: DIRECTIVES[directive[1]][0], range: { start, end: start + directive[1].length + 1 } };
  }
  if (directive && ['param', 'block', 'template', ...(profile.validation ? ['validation'] : [])].includes(directive[1])) {
    const range = wordRange(document, offset);
    const option = document.text.slice(range.start, range.end);
    const docs = directive[1] === 'validation' || validationAt(document, offset) ? RUNTIME_OPTION_DOCS : OPTION_DOCS;
    if (docs[option] && !inQuote(document.text.slice(line.start, range.start)) && (option === 'required' || /^[ \t]*=/.test(document.text.slice(range.end)))) {
      return { contents: docs[option], range };
    }
  }
  return null;
}
function getSymbols(project, uri) {
  const document = project.documents.get(uri);
  if (!document) return [];
  const toSymbol = (symbol, children) => ({ name: symbol.name, kind: symbol.kind, detail: symbol.kind === 'block' ? signature(symbol) : symbol.type || '', start: symbol.lineStart, end: Math.max(symbol.lineEnd, symbol.bodyEnd), selectionStart: symbol.start, selectionEnd: symbol.end, ...(children?.length ? { children: children.map(child => toSymbol(child)) } : {}) });
  const sectionParams = new Set(document.sections.flatMap(section => section.params));
  return [...document.validationBlocks.map(block => toSymbol(block, block.params)), ...document.types.map(type => toSymbol(type, type.fields)), ...document.sections.map(section => toSymbol(section, section.params)), ...document.params.filter(param => !sectionParams.has(param)).map(param => toSymbol(param)), ...document.blocks.map(block => toSymbol(block, block.args)), ...document.scopes.filter(scope => scope.kind === 'layout').map(scope => toSymbol(scope))].sort((a, b) => a.start - b.start);
}

module.exports = {
  BUILTIN_TYPES, DIALECTS, DEFAULT_DIALECT, DIALECT_PROFILES, RUNTIME_SOURCES, SAFE_RUNTIME_SOURCES, RUNTIME_TYPES, COMMON_HEADERS,
  normalizeDialect, phpSpans, parseDocument, buildProject, getRuntimeMacros, getCompletions, getDefinition, getHover, getSignatureHelp, getSymbols,
};
