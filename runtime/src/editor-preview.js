import {parse, parseFragment} from 'parse5';

const marker = '\u0001';
const tokens = /\u0001(\d+)\u0001/g;
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const sourceExtension = /\.(?:tpl(?:\.html)?|html?)$/i;
const pathKey = path => JSON.stringify(path);
const blank = text => text.replace(/[^\r\n]/g, ' ');

// Keep original UTF-16 positions, including CRLF and surrogate pairs. Only DSL
// declarations and directive lines are masked; interpolation remains opaque.
function markupSource(source, plainHtml) {
  if (plainHtml) return source;
  let preview = false;
  return source.replace(/[^\r\n]*(?:\r\n|\r|\n|$)/g, line => {
    const match = /^\s*@([A-Za-z]+)\b/.exec(line);
    if (preview) { if (match?.[1] === 'endpreviewData') preview = false; return blank(line); }
    if (match?.[1] === 'previewData') { preview = true; return blank(line); }
    return match && /^(?:template|section|endsection|param|type|endtype|block|endblock|layout|endlayout|include|render|each|endeach|if|endif|unless|endunless)$/.test(match[1]) ? blank(line) : line;
  });
}
function walk(node, visit) {
  const pending = [{node,parent:null}];
  while (pending.length) {
    const {node,parent} = pending.pop(); visit(node,parent);
    const children = [...(node.childNodes || []),...(node.content ? [node.content] : [])];
    for (let index = children.length - 1; index >= 0; index--) pending.push({node:children[index],parent:node});
  }
}
function bodyBoundaries(source) {
  const result = []; let offset = 0;
  for (const line of source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (/^\s*@(?:block|endblock|layout|endlayout|type|endtype|previewData|endpreviewData)\b/.test(line)) result.push(offset);
    offset += line.length;
  }
  return result;
}
function sourceElements(source) {
  const found = new Map();
  // A document preserves explicit body/html tags; a fragment preserves reusable
  // blocks before a layout. We accept only explicit source-backed boundaries.
  for (const parser of [parse,parseFragment]) {
    const duplicates = [], tree = parser(source,{sourceCodeLocationInfo:true,onParseError:error => { if (error.code === 'duplicate-attribute') duplicates.push(error.startOffset); }});
    walk(tree, node => {
      const location = node.sourceCodeLocation;
      if (!node.tagName || !location || !location.startTag && !voidTags.has(node.tagName)) return;
      if (!voidTags.has(node.tagName) && !location.endTag) return;
      const startTag = location.startTag || location;
      if (duplicates.some(offset => startTag.startOffset <= offset && offset < startTag.endOffset)) return;
      found.set(location.startOffset,node);
    });
  }
  return [...found.values()].sort((a,b) => a.sourceCodeLocation.startOffset - b.sourceCodeLocation.startOffset);
}
function staticLabel(node, source) {
  const attr = node.attrs?.find(attr => attr.name === 'data-block'), location = node.sourceCodeLocation?.attrs?.['data-block'];
  if (!attr || !location || !attr.value.trim()) return null;
  const raw = source.slice(location.startOffset, location.endOffset);
  if (!/^data-block\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'`=<>]+)$/i.test(raw) || /\{\{|\{(?:query|actions|locale)(?:\.|\})/.test(raw)) return null;
  return attr.value;
}

/** Original, contiguous element ranges. Identical labels are intentionally legal. */
export function indexEditorBlocks(files) {
  const result = [];
  for (const path of Object.keys(files).sort()) {
    const source = files[path];
    if (typeof source !== 'string' || !sourceExtension.test(path)) continue;
    const plainHtml = /\.html?$/i.test(path) && !/\.tpl\.html$/i.test(path);
    const markup = markupSource(source,plainHtml), boundaries = plainHtml ? [] : bodyBoundaries(source);
    for (const node of sourceElements(markup)) {
      const label = staticLabel(node, source);
      if (label === null) continue;
      const {startOffset:start, endOffset:end} = node.sourceCodeLocation;
      if (boundaries.some(offset => start < offset && offset < end)) continue;
      result.push({id:`block-${result.length + 1}`, label, path, start, end, content:source.slice(start,end)});
    }
  }
  return result;
}

/** A scoped replacement must retain one complete marked root element. */
export function validateEditorBlockFragment(content, label) {
  if (typeof content !== 'string') return false;
  const start = content.search(/\S/), end = content.trimEnd().length;
  if (start < 0) return false;
  return sourceElements(markupSource(content,false)).some(node => {
    const location = node.sourceCodeLocation;
    return location.startOffset === start && location.endOffset === end && staticLabel(node,content) === label;
  });
}

function injectedFiles(files, sources, attribute, sourceTokens) {
  const result = {...files}, edits = new Map();
  for (const source of sources) {
    const token = `${source.id}`;
    sourceTokens.set(token,source);
    let end = 1, quote = '';
    for (; end < source.content.length; end++) {
      const char = source.content[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    const offset = source.start + end - (source.content[end - 1] === '/' ? 1 : 0);
    if (!edits.has(source.path)) edits.set(source.path,[]);
    edits.get(source.path).push({offset, text:` ${attribute}="${token}"`});
  }
  for (const [path, changes] of edits) {
    let source = files[path];
    for (const {offset,text} of changes.sort((a,b) => b.offset - a.offset)) source = source.slice(0,offset) + text + source.slice(offset);
    result[path] = source;
  }
  return result;
}

function assemble(segments, fail) {
  let markup = ''; const values = [], literals = [], controls = [];
  for (const segment of segments) {
    if (segment.controlPath) controls.push({offset:markup.length, path:segment.controlPath});
    if (segment.literal) {
      if (segment.value.includes(marker)) fail('Control characters are forbidden in markup');
      const start = markup.length; markup += segment.value;
      if (segment.value) literals.push({start,end:markup.length,key:segment.traceKey});
    } else { markup += `${marker}${values.length}${marker}`; values.push(segment); }
  }
  return {markup,values,literals,controls};
}
function instrument(segments, attribute, sourceTokens, page, fail, renderHtml, budget, maxOperations) {
  const {markup,values,literals,controls} = assemble(segments,fail), instances = [], elements = [], replacements = [];
  // Binary lookup avoids scanning every emitted literal for every instance.
  const literalAt = offset => {
    let low = 0, high = literals.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1, span = literals[mid];
      if (offset < span.start) high = mid - 1; else if (offset >= span.end) low = mid + 1; else return span;
    }
    return null;
  };
  const nodeOwners = new WeakMap();
  walk(parse(markup,{sourceCodeLocationInfo:true}), (node,parentNode) => {
    const parentOwner = parentNode && nodeOwners.get(parentNode);
    if (parentOwner) nodeOwners.set(node,parentOwner);
    const sourceToken = node.attrs?.find(attr => attr.name === attribute)?.value, source = sourceTokens.get(sourceToken);
    const location = node.sourceCodeLocation;
    if (!source || !location?.attrs?.[attribute]) return;
    const span = literalAt(location.startOffset);
    if (!span) return;
    const id = `${source.id}-${span.key.join('-')}-${location.startOffset - span.start}`;
    const instance = {id,sourceId:source.id,label:source.label,page,valuePaths:[]};
    if (parentOwner) instance.parentId = parentOwner.id;
    nodeOwners.set(node,instance);
    instances.push(instance); elements.push({start:location.startOffset,end:location.endOffset,instance});
    if (renderHtml) {
      const internal = location.attrs[attribute];
      replacements.push({start:internal.startOffset,end:internal.endOffset,text:`data-tops-block-instance="${id}"`});
      const existing = location.attrs['data-tops-block-instance'];
      if (existing) replacements.push({start:existing.startOffset,end:existing.endOffset,text:''});
    }
  });
  const uses = [], uniqueUses = new Set(), pathsByInstance = new Map(), events = [], active = new Map();
  for (const element of elements) {
    events.push({offset:element.start,kind:1,element});
    events.push({offset:element.end,kind:0,element});
  }
  for (const match of markup.matchAll(tokens)) events.push({offset:match.index,kind:2,path:values[Number(match[1])].valuePath});
  for (const control of controls) events.push({...control,kind:2,control:true});
  const addUse = (path, control = false) => {
    if (!path) return;
    const owners = [...active.keys()];
    budget.operations += owners.length + 1;
    if (budget.operations > maxOperations) fail('Editor preview provenance exceeds its operation budget');
    // Each consumer belongs to its nearest marked element. Parent selections
    // expand to descendants; including ancestors here would weaken that guard.
    const use = {path,instanceIds:owners.length ? [owners.at(-1)] : [],page,...(control ? {control:true} : {})};
    const key = JSON.stringify(use);
    if (!uniqueUses.has(key)) { uniqueUses.add(key); uses.push(use); }
    if (!control) for (const id of owners) {
      if (!pathsByInstance.has(id)) pathsByInstance.set(id,new Map());
      pathsByInstance.get(id).set(pathKey(path),path);
    }
  };
  for (const event of events.sort((a,b) => a.offset - b.offset || a.kind - b.kind || (b.element?.end || 0) - (a.element?.end || 0))) {
    if (event.kind === 0) active.delete(event.element.instance.id);
    else if (event.kind === 1) active.set(event.element.instance.id,event.element);
    else addUse(event.path,event.control);
  }
  for (const instance of instances) instance.valuePaths = [...(pathsByInstance.get(instance.id)?.values() || [])];
  if (!renderHtml) return {instances,uses};
  let rewritten = markup;
  for (const change of replacements.sort((a,b) => b.start - a.start)) rewritten = rewritten.slice(0,change.start) + change.text + rewritten.slice(change.end);
  const output = []; let cursor = 0;
  for (const match of rewritten.matchAll(tokens)) {
    if (cursor < match.index) output.push({literal:true,value:rewritten.slice(cursor,match.index)});
    output.push(values[Number(match[1])]); cursor = match.index + match[0].length;
  }
  if (cursor < rewritten.length) output.push({literal:true,value:rewritten.slice(cursor)});
  return {segments:output,instances,uses};
}

/** Called only by the editor-specific runtime entry point. */
export function createEditorPreview(files, data, context, options, runtime) {
  runtime.assertFiles(files);
  const blockSources = indexEditorBlocks(files), sourceTokens = new Map();
  // The private attribute name cannot collide with authored source or field HTML.
  const attribute = `data-tops-source-${globalThis.crypto.randomUUID().replaceAll('-','')}`;
  const project = runtime.parseProject(injectedFiles(files,blockSources,attribute,sourceTokens),attribute);
  const output = {}, blockInstances = [], valueUses = [];
  for (const [path,value] of Object.entries(files)) if (!/\.tpl(?:\.html)?$/i.test(path)) output[path] = value;
  let rendered = 0; const budget = {operations:0};
  for (const [pageIndex,definition] of project.pages.entries()) {
    const segments = runtime.renderSegments(definition,data,context,{...options,pageIndex,allBranches:false});
    const traced = instrument(segments,attribute,sourceTokens,definition.entrypoint,runtime.fail,true,budget,runtime.maxOperations);
    const html = runtime.encode(traced.segments);
    if ((rendered += runtime.bytes(html)) > runtime.maxOutputBytes) runtime.fail('Combined rendered pages exceed 8 MiB');
    output[definition.entrypoint] = html; blockInstances.push(...traced.instances);
    const allSegments = runtime.renderSegments(definition,data,context,{...options,pageIndex,allBranches:true});
    const potential = instrument(allSegments,attribute,sourceTokens,definition.entrypoint,runtime.fail,false,budget,runtime.maxOperations);
    const visibleIds = new Set(traced.instances.map(instance => instance.id)), potentialParents = new Map(potential.instances.map(instance => [instance.id,instance.parentId]));
    for (const use of potential.uses) {
      let owner = use.instanceIds[0];
      while (owner && !visibleIds.has(owner)) owner = potentialParents.get(owner);
      // Keep every hidden dependency. A visible containing block owns it;
      // otherwise [] prevents a selected sibling from changing shared data.
      valueUses.push({...use,instanceIds:owner ? [owner] : []});
    }
  }
  if (Object.values(output).reduce((total,value) => total + runtime.bytes(value),0) > runtime.maxProjectBytes) runtime.fail('Generated project exceeds 32 MiB');
  return {files:output,blockSources,blockInstances,valueUses};
}
