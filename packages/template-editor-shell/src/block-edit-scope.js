import { parse, parseFragment } from 'parse5';
import { validateProject } from './project.js';

const own = (value, key) => value != null && Object.hasOwn(value, key);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const copyFiles = files => Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? value : value.slice()]));
const sameFile = (left, right) => typeof left === 'string' || typeof right === 'string' ? left === right
  : left instanceof Uint8Array && right instanceof Uint8Array && left.length === right.length && left.every((byte, index) => byte === right[index]);
const error = message => { throw new Error(`Selected-block scope: ${message}`); };

export function blockValuePath(path) {
  let parts;
  if (Array.isArray(path)) parts = [...path];
  else if (typeof path === 'string' && path.startsWith('/')) parts = path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  else if (typeof path === 'string') parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  else error('Invalid field path.');
  if (!parts.length || parts.some(part => !['string', 'number'].includes(typeof part) || String(part) === '' || unsafeKeys.has(String(part)) || typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))) error('Invalid field path.');
  return '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function parts(path) { return blockValuePath(path).slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')); }
export function blockValueAt(values, path) {
  let current = values;
  for (const part of parts(path)) { if (!own(current, part)) return undefined; current = current[part]; }
  return current;
}
const childPath = (path, key) => path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}
function markedElements(source, fragment = false) {
  const found = [], duplicates = [];
  const tree = (fragment ? parseFragment : parse)(source, { sourceCodeLocationInfo: true, onParseError(issue) {
    if (issue.code === 'duplicate-attribute') duplicates.push(issue.startOffset);
  } });
  walk(tree, node => {
    const marker = node.attrs?.find(attribute => attribute.name === 'data-block');
    const location = node.sourceCodeLocation;
    if (marker && location?.startTag && !duplicates.some(offset => location.startTag.startOffset <= offset && offset < location.startTag.endOffset)
      && (location.endTag || location.endOffset === location.startTag.endOffset)) found.push({ label: marker.value, start: location.startOffset, end: location.endOffset, tag: node.tagName });
  });
  return found;
}
function rootElement(source) {
  let elements = markedElements(source, true).filter(element => element.start === 0 && element.end === source.length);
  if (!elements.length) elements = markedElements(source).filter(element => element.start === 0 && element.end === source.length);
  if (elements.length !== 1) error('Each replacement must contain exactly the selected root element and preserve its explicit closing tag.');
  return elements[0];
}
function protectedSource(source) {
  const protectedParts = [];
  const parser = /^<(?:html|head|body)\b/i.test(source) ? parse : parseFragment;
  walk(parser(source, { sourceCodeLocationInfo: true }), node => {
    const location = node.sourceCodeLocation;
    if (location && (['script', 'style'].includes(node.tagName) || node.tagName === 'link' && node.attrs?.some(attribute => attribute.name === 'rel' && /(?:^|\s)stylesheet(?:\s|$)/i.test(attribute.value)))) protectedParts.push(source.slice(location.startOffset, location.endOffset));
    for (const attribute of node.attrs || []) {
      const scriptUrl = ['href', 'src', 'action', 'formaction', 'data'].includes(attribute.name)
        && /^(?:javascript|vbscript):/i.test(attribute.value.trim().replace(/[\t\r\n]/g, ''));
      if (/^on/.test(attribute.name) || attribute.name === 'srcdoc' || scriptUrl) protectedParts.push(`${node.tagName}:${attribute.name}=${attribute.value}`);
    }
  });
  protectedParts.push(...source.match(/^\s*@(?:template|param|type|endtype|section|endsection|block|endblock|layout|endlayout|include)\b[^\r\n]*$/gm) || []);
  return protectedParts;
}
function sourceDependencies(source) {
  const topology = [], lookups = new Set(), context = [];
  const events = /^([^\S\r\n]*)@(each|if|unless|render|include|endeach|endif|endunless)\b[^\r\n]*|\{\{([\s\S]*?)\}\}/gm;
  for (const event of source.matchAll(events)) {
    if (event[2]) {
      const directive = event[0].trim().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').replace(/:\s*$/, '');
      topology.push([...context, directive].join('\u0000'));
      if (['each', 'if', 'unless'].includes(event[2])) context.push(directive);
      else if (!['render', 'include'].includes(event[2])) {
        const expected = { endeach: '@each ', endif: '@if ', endunless: '@unless ' }[event[2]];
        if (!context.at(-1)?.startsWith(expected)) error('Selected source has unbalanced TPL control flow.');
        context.pop();
      }
    } else {
      const expression = event[3].trim(), prefix = expression[0];
      if (['#', '^', '/'].includes(prefix)) {
        const control = prefix + expression.slice(1).trim();
        topology.push([...context, control].join('\u0000'));
        if (prefix !== '/') context.push(control);
        else { if (context.at(-1)?.slice(1) !== control.slice(1)) error('Selected source has unbalanced TPL control flow.'); context.pop(); }
      } else lookups.add([...context, prefix === '&' ? expression.slice(1).trim() : expression].join('\u0000'));
    }
  }
  if (context.length) error('Selected source must preserve a complete TPL control-flow fragment.');
  return { topology, lookups };
}
function assertSourceDependencies(original, replacement) {
  const before = sourceDependencies(original), after = sourceDependencies(replacement);
  if (!equal(before.topology, after.topology) || [...after.lookups].some(lookup => !before.lookups.has(lookup))) error('Source edits cannot introduce new data dependencies or rebind loops, conditions or reusable-block arguments. This would change value ownership outside the selection.');
}

function checkedSource(source, files) {
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.path !== 'string' || typeof files[source.path] !== 'string' || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start < 0 || source.end <= source.start || source.end > files[source.path].length) error('Invalid source block.');
  const content = files[source.path].slice(source.start, source.end);
  if (source.content !== undefined && source.content !== content) error('The selected source block has changed. Select it again.');
  const root = rootElement(content);
  return { ...source, label: root.label, content };
}
function selectedIds(scope) {
  const selected = new Set(scope.selectedInstanceIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const instance of scope.blockInstances) if (instance.parentId && selected.has(instance.parentId) && !selected.has(instance.id)) { selected.add(instance.id); changed = true; }
  }
  return selected;
}
export function blockScopeSourceTargets(scope) {
  const selected = selectedIds(scope);
  const sourceIds = new Set(scope.blockInstances.filter(instance => selected.has(instance.id)).map(instance => instance.sourceId));
  const candidates = scope.blockSources.filter(source => sourceIds.has(source.id));
  // A parent selection already authorizes its descendant source. One outer
  // replacement avoids overlapping edits and keeps every original offset fixed.
  return candidates.filter(source => !candidates.some(parent => parent.id !== source.id && parent.path === source.path && parent.start <= source.start && source.end <= parent.end));
}
export function blockScopeValueTargets(scope) {
  const selected = selectedIds(scope);
  const referenced = new Set(scope.blockInstances.filter(instance => selected.has(instance.id)).flatMap(instance => instance.valuePaths));
  return [...referenced].filter(path => {
    const value = blockValueAt(scope.baselineEffectiveValues, path);
    const uses = scope.valueUses.filter(use => use.path === path);
    return value !== undefined && scalar(value) && uses.length > 0 && uses.every(use => !use.control && use.instanceIds.length > 0 && use.instanceIds.every(id => selected.has(id)));
  });
}

/** A detached run baseline, suitable for durable draft recovery. */
export function createBlockEditScope(input, { files, rawValues = {}, values = rawValues } = {}) {
  if (!input || input.version !== 1 || !Array.isArray(input.blockSources) || !Array.isArray(input.blockInstances) || !Array.isArray(input.valueUses) || !Array.isArray(input.selectedInstanceIds) || !input.selectedInstanceIds.length) error('Invalid selection metadata.');
  const baselineFiles = copyFiles(input.baselineFiles || files || {});
  validateProject(baselineFiles);
  const sources = input.blockSources.map(source => checkedSource(source, baselineFiles));
  if (new Set(sources.map(source => source.id)).size !== sources.length) error('Duplicate source identifiers.');
  const sourceIds = new Set(sources.map(source => source.id));
  const instances = input.blockInstances.map(instance => {
    if (!instance || typeof instance.id !== 'string' || !sourceIds.has(instance.sourceId) || !Array.isArray(instance.valuePaths)) error('Invalid block instance.');
    return { ...instance, valuePaths: [...new Set(instance.valuePaths.map(blockValuePath))] };
  });
  const ids = new Set(instances.map(instance => instance.id));
  if (ids.size !== instances.length || input.selectedInstanceIds.some(id => !ids.has(id))) error('The selected block no longer exists.');
  if (instances.some(instance => instance.parentId && !ids.has(instance.parentId))) error('Invalid parent block.');
  for (const instance of instances) {
    const chain = new Set([instance.id]); let parent = instance.parentId;
    while (parent) { if (chain.has(parent)) error('Invalid parent cycle.'); chain.add(parent); parent = instances.find(item => item.id === parent)?.parentId; }
  }
  const uses = input.valueUses.map(use => {
    if (!use || !Array.isArray(use.instanceIds) || use.instanceIds.some(id => !ids.has(id))) error('Invalid value ownership.');
    return { ...use, path: blockValuePath(use.path), instanceIds: [...new Set(use.instanceIds)] };
  });
  const intent = input.intent;
  if (intent !== undefined && !['source', 'content', 'mixed'].includes(intent)) error('Invalid editing intent.');
  const scope = { version: 1, page: String(input.page || ''), locale: String(input.locale || ''), blockSources: sources, blockInstances: instances, valueUses: uses,
    selectedInstanceIds: [...new Set(input.selectedInstanceIds)], baselineFiles, baselineRawValues: structuredClone(input.baselineRawValues ?? rawValues),
    baselineEffectiveValues: structuredClone(input.baselineEffectiveValues ?? values), ...(intent ? { intent } : {}) };
  // Both matrices remain host-owned; a model only chooses between the existing
  // source and content capabilities, never supplies paths or source offsets.
  for (const source of blockScopeSourceTargets(scope)) for (const other of blockScopeSourceTargets(scope)) if (source.id !== other.id && source.path === other.path && source.start < other.end && other.start < source.end) error('Source blocks overlap.');
  return scope;
}

export function validateBlockEditScope(input) { return createBlockEditScope(input); }
export function serializeBlockEditScope(input) { return validateBlockEditScope(input); }

export function blockScopeReplacements(scope, files) {
  const targets = scope.intent === 'content' ? [] : blockScopeSourceTargets(scope);
  const replacements = Object.create(null);
  if (Object.keys(files).length !== Object.keys(scope.baselineFiles).length) error('Files cannot be created or deleted.');
  for (const [path, baseline] of Object.entries(scope.baselineFiles)) {
    if (!own(files, path)) error('Files cannot be created or deleted.');
    const local = targets.filter(source => source.path === path).sort((left, right) => left.start - right.start);
    if (!local.length) { if (!sameFile(baseline, files[path])) error(`Unselected file ${path} changed.`); continue; }
    if (typeof files[path] !== 'string') error('Source files must remain text.');
    const current = files[path];
    // Fragment locations preserve original TPL spelling. DOM outerHTML is never
    // serialized back to source, and browser-generated markup is never a patch.
    const nodes = markedElements(current);
    let originalCursor = 0, currentCursor = 0;
    for (const source of local) {
      const frozen = baseline.slice(originalCursor, source.start);
      if (current.slice(currentCursor, currentCursor + frozen.length) !== frozen) error(`Source outside ${source.label} changed.`);
      currentCursor += frozen.length;
      const node = nodes.find(item => item.start === currentCursor && item.label === source.label);
      if (!node) error(`The root marker for ${source.label} must be preserved.`);
      const replacement = current.slice(node.start, node.end);
      if (rootElement(replacement).label !== source.label) error('The selected root marker changed.');
      if (!equal(protectedSource(source.content), protectedSource(replacement))) error('Global CSS, scripts, event handlers, includes and field declarations cannot change. Use Edit project for those changes.');
      if (replacement !== source.content) assertSourceDependencies(source.content, replacement);
      replacements[source.id] = replacement;
      originalCursor = source.end; currentCursor = node.end;
    }
    if (baseline.slice(originalCursor) !== current.slice(currentCursor)) error(`Source outside the selected blocks in ${path} changed.`);
  }
  return replacements;
}

export function blockScopeFiles(scope, replacements = {}) {
  const files = copyFiles(scope.baselineFiles);
  for (const source of blockScopeSourceTargets(scope).sort((left, right) => right.start - left.start)) {
    if (own(replacements, source.id)) files[source.path] = files[source.path].slice(0, source.start) + replacements[source.id] + files[source.path].slice(source.end);
  }
  return files;
}

function assertValues(scope, next) {
  const allowed = new Set(scope.intent === 'source' ? [] : blockScopeValueTargets(scope));
  const ancestor = path => [...allowed].some(target => target.startsWith(path + '/'));
  function inspect(before, after, effective, path, beforeExists = true, requiredRow = false) {
    if (after === undefined && beforeExists) error('Saved fields cannot be deleted.');
    if (scalar(effective)) {
      if (!equal(before, after) && !allowed.has(path)) error(`Unselected field ${path} changed.`);
      return;
    }
    if (Array.isArray(effective)) {
      if (!Array.isArray(after) || after.length !== effective.length || beforeExists && !Array.isArray(before)) error('Repeater rows cannot be added, deleted or reordered.');
      if (!beforeExists && !ancestor(path)) error(`Unselected field ${path} was materialized.`);
      for (let index = 0; index < effective.length; index++) inspect(before?.[index], after[index], effective[index], childPath(path, index), beforeExists && own(before, index), !beforeExists);
      return;
    }
    if (!after || typeof after !== 'object' || Array.isArray(after) || beforeExists && (!before || typeof before !== 'object' || Array.isArray(before))) error(`Field structure ${path || '/'} changed.`);
    if (!beforeExists && !ancestor(path) && !(requiredRow && !Object.keys(after).length)) error(`Unselected field ${path} was materialized.`);
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
      if (unsafeKeys.has(key)) error('Unsafe field key.');
      const nextPath = childPath(path, key), had = own(before, key);
      if (!own(effective, key)) { if (!had || !own(after, key) || !equal(before[key], after[key])) error(`Undeclared saved field ${nextPath} changed.`); continue; }
      if (!own(after, key)) { if (had) error(`Saved field ${nextPath} was deleted.`); continue; }
      inspect(before?.[key], after[key], effective[key], nextPath, had);
    }
  }
  inspect(scope.baselineRawValues, next, scope.baselineEffectiveValues, '');
}

export function assertBlockDraftScope(input, { files, rawValues, values } = {}) {
  const scope = validateBlockEditScope(input);
  validateProject(files);
  blockScopeReplacements(scope, files);
  assertValues(scope, rawValues ?? values ?? {});
  return true;
}

export function assertBlockScopeBase(input, { files, rawValues, values } = {}) {
  const scope = validateBlockEditScope(input);
  if (Object.keys(files || {}).length !== Object.keys(scope.baselineFiles).length || Object.keys(scope.baselineFiles).some(path => !sameFile(files?.[path], scope.baselineFiles[path])) || !equal(rawValues ?? values ?? {}, scope.baselineRawValues)) error('The original project changed. Select the blocks again before applying.');
  return true;
}

export function setBlockScopeValue(scope, rawValues, path, value) {
  path = blockValuePath(path);
  if (scope.intent === 'source' || !blockScopeValueTargets(scope).includes(path)) error('This field is shared outside the selection or is not an editable leaf of the selected instance.');
  if (!scalar(value)) error('Only existing leaf values may be changed.');
  const next = structuredClone(rawValues), keys = parts(path);
  let target = next, effective = scope.baselineEffectiveValues;
  for (const [index, key] of keys.entries()) {
    if (index === keys.length - 1) { target[key] = value; break; }
    effective = effective[key];
    if (!own(target, key)) target[key] = Array.isArray(effective) ? effective.map(() => ({})) : {};
    target = target[key];
  }
  assertValues(scope, next);
  return next;
}
