import { parse } from 'acorn';

export const PROJECT_ORIGIN = 'https://project.trafficops.invalid';

export function projectUrl(path) {
  return new URL(path, `${PROJECT_ORIGIN}/`).href;
}

// Give modules stable logical URLs. Blob URLs are deliberately allocated later,
// inside the opaque frame, so they never carry the Studio application's origin.
export function prepareJavaScript(source, path, runtimeKey, dependencies = new Set()) {
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch {
    try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }); }
    catch (cause) { throw new Error(`${path}: ${cause.message}`, { cause }); }
  }
  const base = projectUrl(path), runtime = `globalThis[${JSON.stringify(runtimeKey)}]`, edits = [];
  const literalUrl = value => /^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(value) ? new URL(value, base).href : value;
  const names = (pattern, output) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') output.add(pattern.name);
    else if (pattern.type === 'RestElement') names(pattern.argument, output);
    else if (pattern.type === 'AssignmentPattern') names(pattern.left, output);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(value => names(value, output));
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(value => names(value.value || value.argument, output));
  };
  function bindings(node, inherited) {
    const functions = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
    if (!['Program', 'BlockStatement', ...functions, 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) return inherited;
    const result = new Set(inherited);
    if (node.id) names(node.id, result);
    node.params?.forEach(value => names(value, result)); names(node.param, result);
    const body = node.type === 'Program' || node.type === 'BlockStatement' ? node.body : node.body?.body || [];
    for (let statement of [...body, node.init, node.left].filter(Boolean)) {
      if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') statement = statement.declaration || statement;
      if (statement.type === 'VariableDeclaration') statement.declarations.forEach(declaration => names(declaration.id, result));
      if (statement.type === 'ImportDeclaration') statement.specifiers.forEach(specifier => names(specifier.local, result));
      if (['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type)) names(statement.id, result);
    }
    if (node.type === 'Program' || functions.includes(node.type)) {
      function hoisted(child) {
        if (!child || typeof child !== 'object' || functions.includes(child.type)) return;
        if (child.type === 'VariableDeclaration' && child.kind === 'var') child.declarations.forEach(declaration => names(declaration.id, result));
        for (const value of Object.values(child)) {
          if (Array.isArray(value)) value.forEach(hoisted); else if (value && typeof value === 'object') hoisted(value);
        }
      }
      body.forEach(hoisted);
    }
    return result;
  }
  function visit(node, bound = new Set(), parent, key) {
    if (!node || typeof node !== 'object') return;
    bound = bindings(node, bound);
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      const target = literalUrl(node.source.value); dependencies.add(target);
      edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(target) });
    }
    if (node.type === 'ImportExpression') {
      edits.push({ start: node.start, end: node.source.start, text: `${runtime}.import(` });
      edits.push({ start: node.source.end, end: node.source.end, text: `,${JSON.stringify(base)}` });
    }
    if (node.type === 'MemberExpression' && node.object?.type === 'MetaProperty' && node.object.meta.name === 'import') {
      const property = node.computed ? node.property.value : node.property.name;
      if (property === 'url') edits.push({ start: node.start, end: node.end, text: JSON.stringify(base) });
      if (property === 'resolve') edits.push({ start: node.start, end: node.end, text: `(value=>${runtime}.resolve(value,${JSON.stringify(base)}))` });
      return;
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && ['window', 'self', 'globalThis'].includes(node.object.name)
      && !bound.has(node.object.name) && (node.computed ? node.property.value : node.property.name) === 'location') {
      edits.push({ start: node.start, end: node.end, text: `${runtime}.location` }); return;
    }
    if (node.type === 'Identifier' && node.name === 'location' && !bound.has('location')) {
      const propertyName = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed
        || ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && key === 'key' && !parent.computed;
      const declaration = ['VariableDeclarator', 'FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration', 'ClassExpression'].includes(parent?.type) && key === 'id'
        || ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) && key === 'label';
      if (!propertyName && !declaration) edits.push({ start: node.start, end: node.end, text: parent?.type === 'Property' && parent.shorthand ? `location: ${runtime}.location` : `${runtime}.location` });
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, bound, node, childKey));
      else if (value && typeof value === 'object') visit(value, bound, node, childKey);
    }
  }
  visit(tree);
  for (const edit of edits.sort((left, right) => right.start - left.start || right.end - left.end)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
