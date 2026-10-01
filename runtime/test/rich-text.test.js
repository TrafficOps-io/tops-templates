import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTemplate, renderTemplate, generateProject, generateEditorPreview} from '../src/index.js';

const article = '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p><figure onclick="alert(1)"><img src="img/article.png" alt="Article" onerror="alert(1)"><figcaption style="position:fixed">Photo caption.</figcaption></figure><p>Last paragraph.</p>';

test('Wysiwyg preserves article paragraphs, figures and captions across render/export/editor preview', () => {
  const source = `@param article_body Wysiwyg = ${JSON.stringify(article)}\n@layout\n<div data-block="Article" class="md rich-text">{{& article_body }}</div>\n@endlayout`;
  const files = {'index.tpl': source, 'img/article.png': new Uint8Array()};
  for (const html of [renderTemplate(parseTemplate(source)), generateProject(files)['index.html'], generateEditorPreview(files).files['index.html']]) {
    assert.match(html, /<p>First paragraph\.<\/p><p>Second <strong>paragraph<\/strong>\.<\/p>/);
    assert.match(html, /<figure><img src="img\/article\.png" alt="Article" \/><figcaption>Photo caption\.<\/figcaption><\/figure><p>Last paragraph\.<\/p>/);
    assert.doesNotMatch(html, /onclick|onerror|position:fixed/);
  }
});

test('both rich-text types require explicit formatted output while ordinary interpolation stays escaped', () => {
  for (const [type, value, formatted] of [
    ['Wysiwyg', '<p>First.</p><p>Second.</p>', '<p>First.</p><p>Second.</p>'],
    ['Markdown', 'First.\n\nSecond.', '<p>First.</p>\n<p>Second.</p>'],
  ]) {
    const definition = parseTemplate(`@param article_body ${type}\n@layout\n<div class="rich-text">{{& article_body }}</div><pre>{{ article_body }}</pre>\n@endlayout`);
    const html = renderTemplate(definition, {article_body: value});
    assert.ok(html.includes(`<div class="rich-text">${formatted}`));
    assert.ok(html.includes(`<pre>${type === 'Wysiwyg' ? '&lt;p&gt;First.&lt;/p&gt;&lt;p&gt;Second.&lt;/p&gt;' : value}</pre>`));
  }
});
