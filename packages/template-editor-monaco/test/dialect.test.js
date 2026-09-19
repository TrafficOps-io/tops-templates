import test from 'node:test';
import assert from 'node:assert/strict';
import { dialectId, modelLanguage, templateFile, languageForDialect } from '../src/index.js';
import { withTemplateExpressions } from '../src/tpl-language.js';
const safe = { schema: 1, id: 'safe-html-v1' }, trusted = { schema: 1, id: 'fast-landings-v1' };
test('host descriptors select known profiles and fail closed for every unknown schema/id', () => {
  for (const descriptor of [undefined, null, {}, { id: safe.id }, { schema: 2, id: safe.id }, { schema: 1, id: 'future' }, { schema: 1, id: '__proto__' }]) {
    const original = { tokenizer: { root: [] } };
    assert.equal(withTemplateExpressions(original, descriptor), original, 'embedded CSS/JS must also require an explicit known descriptor');
    assert.equal(dialectId(descriptor), null);
    assert.equal(modelLanguage('index.tpl', descriptor), 'trafficops-tpl-plain');
    assert.equal(templateFile('index.tpl', descriptor), false);
    assert.equal(languageForDialect(descriptor).tokenizer.root.length, 1);
  }
  assert.equal(modelLanguage('index.tpl', safe), 'trafficops-tpl');
  assert.equal(modelLanguage('index.tpl.php', trusted), 'trafficops-tpl-trusted');
  assert.equal(modelLanguage('index.html', null, 'html'), 'html');
  assert.equal(templateFile('data.tpl.php', safe), false);
  assert.equal(templateFile('data.tpl.php', trusted), true);
});
