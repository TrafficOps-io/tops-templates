'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('trafficops-io.tops-templates');
  assert.ok(extension, 'The packaged extension is discoverable');
  await extension.activate();
  const root = vscode.workspace.workspaceFolders[0].uri;
  const mainUri = vscode.Uri.joinPath(root, 'template.tpl');
  const fragmentUri = vscode.Uri.joinPath(root, 'blocks', 'comment.tpl');
  const main = await vscode.workspace.openTextDocument(mainUri);
  const fragment = await vscode.workspace.openTextDocument(fragmentUri);
  assert.equal(main.languageId, 'fast-landings-tpl');
  await vscode.window.showTextDocument(main);

  const at = (document, marker, delta = marker.length) => {
    const offset = document.getText().indexOf(marker);
    assert.ok(offset >= 0, `Marker exists: ${marker}`);
    return document.positionAt(offset + delta);
  };
  const labels = result => result.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
  const complete = (document, position) => vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position);

  assert.equal(vscode.workspace.getConfiguration('fastLandingsTemplates').get('dialect'), 'safe-html-v1', 'OSS extension defaults to safe HTML');
  await vscode.workspace.getConfiguration('fastLandingsTemplates').update('dialect', 'fast-landings-v1', vscode.ConfigurationTarget.Workspace);
  const runtimeUri = vscode.Uri.joinPath(root, 'runtime', 'success.tpl.php');
  const runtime = await vscode.workspace.openTextDocument(runtimeUri);
  assert.equal(runtime.languageId, 'fast-landings-tpl', '.tpl.php is associated with the TPL language');
  const runtimeCompletions = await complete(runtime, at(runtime, '{body.'));
  assert.ok(labels(runtimeCompletions).includes('name') && labels(runtimeCompletions).includes('phone'), 'Runtime names complete in saved setting defaults');
  assert.ok(!labels(runtimeCompletions).includes('subid'), 'Companion page request rules remain isolated');
  const runtimeTypes = await complete(runtime, at(runtime, '@param phone '));
  assert.ok(labels(runtimeTypes).includes('Integer') && !labels(runtimeTypes).includes('Image'), 'Request validation uses its own supported types');
  const runtimeDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', runtimeUri, at(runtime, '{body.name', '{body.na'.length));
  assert.ok(runtimeDefinitions.some(location => (location.uri || location.targetUri).toString() === runtimeUri.toString()), 'Runtime macro definitions resolve to request declarations');
  const runtimeSymbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', runtimeUri);
  assert.ok(runtimeSymbols.some(symbol => symbol.name === 'body' && symbol.children.some(child => child.name === 'phone')), 'Request validations appear in the outline');

  await vscode.workspace.getConfiguration('fastLandingsTemplates').update('dialect', 'safe-html-v1', vscode.ConfigurationTarget.Workspace);

  let result = await complete(fragment, at(fragment, '{{ comment.author.'));
  assert.ok(labels(result).includes('name'), 'Nested members complete in included blocks');
  assert.ok(labels(result).includes('avatar'));
  result = await complete(main, at(main, '@param comments '));
  assert.ok(labels(result).includes('Comment'), 'Author-defined included types complete');
  result = await complete(main, at(main, '@render '));
  assert.ok(labels(result).some(label => label.startsWith('commentItem')), 'Included blocks complete');
  result = await complete(main, at(main, '@include "blocks/'));
  assert.ok(labels(result).some(label => label.includes('comment.tpl')), 'Root-relative include paths complete');
  const includeItem = result.items.find(item => (typeof item.label === 'string' ? item.label : item.label.label).includes('comment.tpl'));
  assert.equal(main.getText(includeItem.range), 'blocks/comment.tpl', 'Path completion replaces the suffix after the cursor as well');

  const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', main.uri, at(main, '@param comments Comment', '@param comments Com'.length));
  assert.ok(definitions.some(location => (location.uri || location.targetUri).toString() === fragmentUri.toString()), 'Definition navigates to included custom type');
  const includeDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', main.uri, at(main, '@include "blocks/comment', '@include "blocks/com'.length));
  assert.ok(includeDefinitions.some(location => (location.uri || location.targetUri).toString() === fragmentUri.toString()));
  const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', fragment.uri, at(fragment, '{{ comment.author.name', '{{ comment.author.na'.length));
  assert.ok(hover.length > 0, 'Field hover is available');
  const signatures = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', main.uri, at(main, '@render commentItem('));
  assert.ok(signatures.signatures[0].label.includes('Comment'), 'Block signatures expose typed arguments');
  const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', fragment.uri);
  assert.ok(symbols.some(symbol => symbol.name === 'Comment'), 'Types appear in the outline');
  const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', fragment.uri);
  assert.ok(folds.length >= 3, 'Types and blocks fold');

  const richUri = vscode.Uri.joinPath(root, 'rich-text', 'template.tpl');
  const richFragmentUri = vscode.Uri.joinPath(root, 'rich-text', 'blocks', 'article.tpl');
  const rich = await vscode.workspace.openTextDocument(richUri);
  const richFragment = await vscode.workspace.openTextDocument(richFragmentUri);
  result = await complete(richFragment, at(richFragment, '@param body '));
  assert.ok(labels(result).includes('Wysiwyg') && labels(result).includes('Markdown'), 'Both editor types complete');
  result = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', rich.uri, at(rich, '{{&'), '&');
  assert.ok(labels(result).includes('article'), 'Typing & triggers formatted path completion');
  assert.ok(!labels(result).includes('title'), 'Plain text is excluded from formatted suggestions');
  result = await complete(rich, at(rich, '{{& article.'));
  assert.deepEqual(labels(result).sort(), ['body', 'notes']);
  result = await complete(richFragment, at(richFragment, '{{&value.'));
  assert.deepEqual(labels(result).sort(), ['body', 'notes'], 'Formatted paths use typed block arguments');
  const richPosition = at(rich, '{{& article.bo');
  const richDefinitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', richUri, richPosition);
  const richDefinition = richDefinitions.find(location => (location.uri || location.targetUri).toString() === richFragmentUri.toString());
  assert.ok(richDefinition, 'Formatted references navigate to included declarations');
  assert.equal(richFragment.getText(richDefinition.range || richDefinition.targetSelectionRange), 'body');
  const richHover = await vscode.commands.executeCommand('vscode.executeHoverProvider', richUri, richPosition);
  assert.ok(richHover.some(hover => hover.contents.some(content => content.value.includes('sanitized HTML'))));

  // Exercise VS Code's snippet parser as well as the JSON contribution itself.
  const snippets = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'snippets/fast-landings-tpl.json'), 'utf8'));
  const snippetUri = vscode.Uri.joinPath(root, 'snippet.tpl');
  await vscode.workspace.fs.writeFile(snippetUri, Buffer.from(''));
  const snippetDocument = await vscode.workspace.openTextDocument(snippetUri);
  const snippetEditor = await vscode.window.showTextDocument(snippetDocument);
  for (const [name, expected] of [
    ['WYSIWYG setting', '@param body Wysiwyg = "<p>Write your article.</p>" label="Article"'],
    ['Markdown setting', '@param details Markdown = "**Write your article.**" label="Details"'],
    ['Formatted editor content', '{{& body}}'],
    ['Preview data', '@previewData\n{\n\t"title": "Demo"\n}\n@endpreviewData'],
    ['Public preview URL', 'previewUrl="https://example.com/demo"'],
  ]) {
    const range = new vscode.Range(snippetDocument.positionAt(0), snippetDocument.positionAt(snippetDocument.getText().length));
    const body = snippets[name].body;
    await snippetEditor.insertSnippet(new vscode.SnippetString(Array.isArray(body) ? body.join('\n') : body), range);
    assert.equal(snippetDocument.getText().replace(/^ +(?="title":)/m, '\t'), expected, `${name} expands into valid DSL`);
    await vscode.commands.executeCommand('leaveSnippet');
  }
  await snippetDocument.save();

  const previewUri = vscode.Uri.joinPath(root, 'preview.tpl');
  await vscode.workspace.fs.writeFile(previewUri, Buffer.from('@template "Preview" previewUrl="https://example.com/demo"\n@previewData\n{"title":"Demo","literal":"{{title}}"}\n@endpreviewData\n@param title String = "Default"\n'));
  const preview = await vscode.workspace.openTextDocument(previewUri);
  result = await complete(preview, at(preview, '@template "Preview" '));
  assert.ok(labels(result).includes('previewUrl'), 'Preview URL is offered in template headers');
  const previewFolds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', previewUri);
  assert.ok(previewFolds.some(fold => fold.start === 1 && fold.end === 2), 'Preview JSON folds as a block');
  assert.deepEqual(vscode.languages.getDiagnostics(previewUri), [], 'Valid metadata has no diagnostics');
  const previewEdit = new vscode.WorkspaceEdit();
  previewEdit.replace(previewUri, new vscode.Range(at(preview, '{"title":', 0), at(preview, '{"title":"Demo","literal":"{{title}}"}')), '[]');
  await vscode.workspace.applyEdit(previewEdit);
  assert.ok(vscode.languages.getDiagnostics(previewUri).some(issue => /valid JSON object/.test(issue.message)), 'Preview data diagnostics update after edits');

  // Buffer edits must immediately participate in cross-file completion.
  const edits = new vscode.WorkspaceEdit();
  const name = fragment.getText().indexOf('@param name String');
  edits.insert(fragment.uri, fragment.positionAt(name), '@param nickname String\n');
  await vscode.workspace.applyEdit(edits);
  result = await complete(fragment, at(fragment, '{{ comment.author.'));
  assert.ok(labels(result).includes('nickname'), 'Unsaved declarations are indexed');

  const htmlUri = vscode.Uri.joinPath(root, 'article.html');
  await vscode.workspace.fs.writeFile(htmlUri, Buffer.from('@template "Detected" version=1\n@layout\n<h1>Hello</h1>\n@endlayout'));
  const html = await vscode.workspace.openTextDocument(htmlUri);
  for (let attempt = 0; attempt < 30 && html.languageId !== 'fast-landings-tpl'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(vscode.workspace.textDocuments.find(document => document.uri.toString() === htmlUri.toString()).languageId, 'fast-landings-tpl', 'DSL HTML is recognized');
  const ordinaryUri = vscode.Uri.joinPath(root, 'ordinary.html');
  await vscode.workspace.fs.writeFile(ordinaryUri, Buffer.from('<html><body>Ordinary HTML</body></html>'));
  const ordinary = await vscode.workspace.openTextDocument(ordinaryUri);
  assert.equal(ordinary.languageId, 'html', 'Ordinary HTML retains its language');

  const formattingUri = vscode.Uri.joinPath(root, 'formatting.tpl');
  const messy = [
    '@template "Format" version=1',
    '@type Comment',
    '@param name String = "Guest"',
    '@endtype',
    '@param title String = "Hello"',
    '@layout',
    '<html><head><style>.card{color:red;padding:12px}</style></head><body>',
    '<section><h1>{{title}}</h1><p>Formatted</p></section>',
    '<script>const values=[1,2].map(value=>({value:value*2}));</script>',
    '</body></html>',
    '@endlayout',
    '',
  ].join('\n');
  await vscode.workspace.fs.writeFile(formattingUri, Buffer.from(messy));
  const formatting = await vscode.workspace.openTextDocument(formattingUri);
  const editor = await vscode.window.showTextDocument(formatting);
  editor.options = { tabSize: 2, insertSpaces: true };
  await vscode.commands.executeCommand('editor.action.formatDocument');
  const formatted = formatting.getText();
  assert.notEqual(formatted, messy, 'Format Document invokes the bundled formatter');
  assert.match(formatted, /@type Comment\r?\n {2}@param name String/, 'Record members are indented');
  assert.match(formatted, /color: red;/, 'Embedded CSS is formatted');
  assert.match(formatted, /const values = \[1, 2\]/, 'Embedded JavaScript is formatted');
  assert.match(formatted, /<section>\r?\n\s+<h1>/, 'HTML tags are indented on separate lines');
  assert.ok(formatted.includes('{{title}}'), 'DSL interpolation survives formatting');
  let formattingEdits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', formattingUri, { tabSize: 2, insertSpaces: true });
  assert.equal(formattingEdits?.length ?? 0, 0, 'Repeated formatting is a no-op');
  formattingEdits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', formattingUri, { tabSize: 4, insertSpaces: false });
  const tabEdits = new vscode.WorkspaceEdit();
  tabEdits.set(formattingUri, formattingEdits);
  await vscode.workspace.applyEdit(tabEdits);
  assert.match(formatting.getText(), /^\t@param name String/m, 'VS Code tab indentation is respected');

  await vscode.workspace.getConfiguration('fastLandingsTemplates', formattingUri).update('format.enable', false, vscode.ConfigurationTarget.Workspace);
  formattingEdits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', formattingUri, { tabSize: 4, insertSpaces: false });
  assert.equal(formattingEdits?.length ?? 0, 0, 'Formatting can be disabled per workspace');
  await vscode.workspace.getConfiguration('fastLandingsTemplates', formattingUri).update('format.enable', true, vscode.ConfigurationTarget.Workspace);
  const editorConfiguration = vscode.workspace.getConfiguration('editor', formattingUri);
  await editorConfiguration.update('detectIndentation', false, vscode.ConfigurationTarget.Workspace);
  await editorConfiguration.update('tabSize', 2, vscode.ConfigurationTarget.Workspace);
  await editorConfiguration.update('insertSpaces', true, vscode.ConfigurationTarget.Workspace);
  await editorConfiguration.update('formatOnSave', true, vscode.ConfigurationTarget.Workspace);
  editor.options = { tabSize: 2, insertSpaces: true };
  await editor.edit(builder => builder.replace(new vscode.Range(formatting.positionAt(0), formatting.positionAt(formatting.getText().length)), messy));
  assert.equal(await formatting.save(), true);
  assert.equal(formatting.getText(), formatted, 'Format on Save uses the same formatter');
  console.log('Extension Host: language features, Format Document, Format on Save, formatting settings, tabs and idempotence passed.');
}

module.exports = { run };
