// Authoring syntax follows docs/language-v1.md and the VS Code TPL grammar.
// This module is independent of browser globals so the real Monarch engine can
// exercise the same definitions in the editor's Node test suite.
import { TPL_LANGUAGE_IDS, TPL_PLAIN_LANGUAGE_ID, dialectProfile } from './dialect.js';
export const TPL_LANGUAGE_ID = TPL_LANGUAGE_IDS['safe-html-v1'];

const expressionRules = [
  [/\}\}/, 'delimiter.template', '@pop'],
  [/\r?\n/, '', '@pop'],
  [/[@]root\b/, 'variable.predefined'],
  [/\.\.\//, 'operator'],
  [/[&#^/>]/, 'operator'],
  [/[A-Za-z][A-Za-z0-9_]*/, 'variable'],
  [/\./, 'delimiter'],
  [/[ \t]+/, ''],
  [/./, 'invalid'],
];
const interpolationRules = [
  [/\\\{(?:query|actions)\.[A-Za-z][A-Za-z0-9_]*\}|\\\{locale\}/, 'string.escape'],
  [/\{\{/, 'delimiter.template', '@tplExpression'],
  [/(\{)((?:query|actions))(?=\.)/, ['delimiter.template', { token: 'variable.predefined', next: '@tplRuntime' }]],
  [/(\{)(locale)(\})/, ['delimiter.template', 'variable.predefined', 'delimiter.template']],
];
const runtimeRules = [
  [/\}/, 'delimiter.template', '@pop'],
  [/\r?\n/, '', '@pop'],
  [/[A-Za-z][A-Za-z0-9_]*/, 'variable'],
  [/\./, 'delimiter'],
  [/./, 'invalid'],
];
const optionRules = [
  [/\r?\n/, '', '@popall'],
  [/"/, 'string', '@optionDouble'],
  [/'/, 'string', '@optionSingle'],
  [/([A-Za-z][A-Za-z0-9_]*)(\s*)(=)/, ['attribute.name', '', 'operator']],
  [/\brequired\b/, 'attribute.name'],
  [/\b(?:true|false|null)\b/, 'keyword'],
  [/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/, 'number'],
  [/([A-Za-z][A-Za-z0-9_]*)(\s*)(:)(\s*)([A-Za-z][A-Za-z0-9_]*)(\[\]|)/, ['variable.parameter', '', 'delimiter', '', 'type.identifier', 'delimiter']],
  [/\bin\b/, 'keyword'],
  [/[A-Za-z][A-Za-z0-9_]*/, 'variable'],
  [/[=:#^/>]/, 'operator'],
  [/[()[\],.]/, 'delimiter'],
  [/[ \t]+/, ''],
];

export const tplLanguage = {
  defaultToken: '', tokenPostfix: '.tpl', includeLF: true,
  tokenizer: {
    root: [
      [/^(\s*)([@][@][^\r\n]*)/, ['', 'string.escape']],
      [/^(\s*)([@]previewData)\b/, ['', { token: 'keyword.directive', next: '@previewData' }]],
      [/^(\s*)([@]param)([ \t]+)([A-Za-z][A-Za-z0-9_]*)([ \t]+)([A-Za-z][A-Za-z0-9_]*)(\[\]|)/, ['', 'keyword.directive', '', 'variable', '', { token: 'type.identifier', next: '@options' }, 'delimiter']],
      [/^(\s*)([@]type)([ \t]+)([A-Za-z][A-Za-z0-9_]*)/, ['', 'keyword.directive', '', { token: 'type.identifier', next: '@options' }]],
      [/^(\s*)([@](?:block|render))([ \t]+)([A-Za-z][A-Za-z0-9_]*)/, ['', 'keyword.directive', '', { token: 'entity.name.function', next: '@options' }]],
      [/^(\s*)([@](?:template|section|param|type|block|render|each|if|unless|include|layout|endsection|endtype|endblock|endeach|endif|endunless|endlayout|endpreviewData))\b/, ['', { token: 'keyword.directive', next: '@options' }]],
      { include: '@tplInterpolations' },
      [/<!--[\s\S]*?-->/, 'comment'],
      [/<!--/, 'comment', '@comment'],
      [/<![dD][oO][cC][tT][yY][pP][eE]/, 'metatag', '@doctype'],
      [/(<)([sS][cC][rR][iI][pP][tT])(?=[\s>])/, ['delimiter', { token: 'tag', next: '@scriptTag' }]],
      [/(<)([sS][tT][yY][lL][eE])(?=[\s>])/, ['delimiter', { token: 'tag', next: '@styleTag' }]],
      [/(<\/?)([\w:-]+)/, ['delimiter', { token: 'tag', next: '@tag' }]],
      [/&(?:[\w]+|#\d+|#x[\da-fA-F]+);/, 'string.escape'],
      [/[^<{&\r\n]+/, ''],
      [/./, ''],
    ],
    options: optionRules,
    optionDouble: [
      [/\r?\n/, '', '@popall'], [/\\./, 'string.escape'], [/"/, 'string', '@pop'], [/[^\\"\r\n]+/, 'string'], [/./, 'string'],
    ],
    optionSingle: [
      [/\r?\n/, '', '@popall'], [/\\./, 'string.escape'], [/'/, 'string', '@pop'], [/[^\\'\r\n]+/, 'string'], [/./, 'string'],
    ],
    previewData: [
      [/^(\s*)([@]endpreviewData)\b/, ['', { token: 'keyword.directive', next: '@pop' }]],
      [/"(?:[^"\\\r\n]|\\.)*(?:"|$)/, 'string'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/, 'number'],
      [/[{}[\]:,]/, 'delimiter'],
      [/[ \t\r\n]+/, ''],
      [/./, 'invalid'],
    ],
    tplInterpolations: interpolationRules,
    tplExpression: expressionRules,
    tplRuntime: runtimeRules,
    tag: [[/\/?>/, 'delimiter', '@pop'], { include: '@attributes' }],
    attributes: [
      { include: '@tplInterpolations' },
      [/"/, 'attribute.value', '@attributeDouble'],
      [/'/, 'attribute.value', '@attributeSingle'],
      [/[\w:-]+/, 'attribute.name'], [/=/, 'delimiter'], [/[ \t\r\n]+/, ''], [/./, ''],
    ],
    attributeDouble: [
      { include: '@tplInterpolations' }, [/"/, 'attribute.value', '@pop'], [/[^"{\\]+/, 'attribute.value'], [/./, 'attribute.value'],
    ],
    attributeSingle: [
      { include: '@tplInterpolations' }, [/'/, 'attribute.value', '@pop'], [/[^'{\\]+/, 'attribute.value'], [/./, 'attribute.value'],
    ],
    comment: [[/-->/, 'comment', '@pop'], [/[^-]+/, 'comment'], [/./, 'comment']],
    doctype: [[/>/, 'metatag', '@pop'], [/[^>]+/, 'metatag']],
    scriptTag: [
      [/>/, { token: 'delimiter', next: '@scriptEmbedded', nextEmbedded: 'trafficops-tpl-javascript' }],
      [/<\/[sS][cC][rR][iI][pP][tT]\s*>/, { token: '@rematch', next: '@pop' }],
      { include: '@attributes' },
    ],
    styleTag: [
      [/>/, { token: 'delimiter', next: '@styleEmbedded', nextEmbedded: 'trafficops-tpl-css' }],
      [/<\/[sS][tT][yY][lL][eE]\s*>/, { token: '@rematch', next: '@pop' }],
      { include: '@attributes' },
    ],
    scriptEmbedded: [[/<\/[sS][cC][rR][iI][pP][tT](?=[\s>])/, { token: '@rematch', next: '@popall', nextEmbedded: '@pop' }]],
    styleEmbedded: [[/<\/[sS][tT][yY][lL][eE](?=[\s>])/, { token: '@rematch', next: '@popall', nextEmbedded: '@pop' }]],
  },
};

// The host chooses this profile; declarations in the source cannot enable it.
export function languageForDialect(descriptor) {
  const profile = dialectProfile(descriptor);
  if (!profile) return { tokenizer: { root: [[/.+/, '']] } };
  if (!profile.php) return tplLanguage;
  const runtime = [
    [/\\\{(?:query|headers|body)\.[^}\r\n]+\}/, 'string.escape'],
    [/\{\{/, 'delimiter.template', '@tplExpression'],
    [/(\{)((?:query|headers|body))(?=\.)/, ['delimiter.template', { token: 'variable.predefined', next: '@tplRuntime' }]],
  ];
  return { ...tplLanguage, tokenizer: {
    ...tplLanguage.tokenizer,
    root: [
      [/^(\s*)([@](?:validation|endvalidation))\b/, ['', { token: 'keyword.directive', next: '@options' }]],
      ...tplLanguage.tokenizer.root,
    ],
    tplInterpolations: runtime,
    tplRuntime: [[/\*/, 'variable'], [/[A-Za-z0-9_][A-Za-z0-9_-]*/, 'variable'], ...runtimeRules],
    scriptTag: tplLanguage.tokenizer.scriptTag.map(rule => Array.isArray(rule) && rule[1]?.nextEmbedded
      ? [rule[0], { ...rule[1], nextEmbedded: 'trafficops-tpl-trusted-javascript' }] : rule),
    styleTag: tplLanguage.tokenizer.styleTag.map(rule => Array.isArray(rule) && rule[1]?.nextEmbedded
      ? [rule[0], { ...rule[1], nextEmbedded: 'trafficops-tpl-trusted-css' }] : rule),
  } };
}

// Extend the bundled CSS/JavaScript grammars rather than interrupting embedding.
// Pushing an expression state preserves the surrounding string/rule state when
// it closes. Quoted runs must stop before `{` so they cannot swallow `{{path}}`.
export function withTemplateExpressions(language, descriptor) {
  const template = languageForDialect(descriptor);
  if (!dialectProfile(descriptor)) return language;
  const tokenizer = Object.fromEntries(Object.entries(language.tokenizer).map(([state, rules]) => {
    if (/comment|jsdoc|regexp|regexrange/i.test(state)) return [state, rules];
    let next = rules;
    if (/^(?:string_|stringend)/.test(state)) {
      next = rules.map(rule => {
        if (!Array.isArray(rule)) return rule;
        const pattern = rule[0], source = pattern instanceof RegExp ? pattern.source : pattern;
        if (!source.startsWith('[^')) return rule;
        const replaced = source.replace('[^', '[^{');
        return [pattern instanceof RegExp ? new RegExp(replaced, pattern.flags) : replaced, ...rule.slice(1)];
      });
      next = [...next, [/\{/, 'string']];
    }
    if (state === 'urldeclaration') next = rules.map(rule => Array.isArray(rule) && rule[0] === '[^)\r\n]+' ? ['[^){\r\n]+', ...rule.slice(1)] : rule);
    return [state, [{ include: '@tplInterpolations' }, ...next]];
  }));
  return { ...language, includeLF: true, tokenizer: { ...tokenizer, tplInterpolations: template.tokenizer.tplInterpolations, tplExpression: expressionRules, tplRuntime: template.tokenizer.tplRuntime } };
}

export const tplConfiguration = {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [['{{', '}}'], ['(', ')'], ['[', ']'], ['{', '}']],
  autoClosingPairs: [{ open: '{{', close: '}}', notIn: ['string', 'comment'] }, { open: '"', close: '"' }, { open: "'", close: "'" }, { open: '(', close: ')' }, { open: '[', close: ']' }],
  surroundingPairs: [{ open: '"', close: '"' }, { open: "'", close: "'" }, { open: '{{', close: '}}' }, { open: '(', close: ')' }],
  folding: { markers: { start: /^\s*@(section|type|block|layout|each|if|previewData)\b/, end: /^\s*@end(section|type|block|layout|each|if|previewData)\b/ } },
};

export function registerTplLanguage(monaco, { css, javascript, htmlConfiguration = {} }) {
  if (monaco.languages.getLanguages().some(language => language.id === TPL_PLAIN_LANGUAGE_ID)) return;
  monaco.languages.register({ id: TPL_PLAIN_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(TPL_PLAIN_LANGUAGE_ID, languageForDialect(null));
  for (const [dialect, languageId] of Object.entries(TPL_LANGUAGE_IDS)) {
  const descriptor = { schema: 1, id: dialect };
  for (const [id, language] of [[`${languageId}-css`, css], [`${languageId}-javascript`, javascript]]) {
    monaco.languages.register({ id });
    monaco.languages.setMonarchTokensProvider(id, withTemplateExpressions(language, descriptor));
  }
  // No extension auto-detection: modelLanguage requires a host descriptor.
  monaco.languages.register({ id: languageId });
  monaco.languages.setLanguageConfiguration(languageId, {
    ...htmlConfiguration, ...tplConfiguration,
    indentationRules: {
      increaseIndentPattern: /^\s*@(section|type|block|layout|each|if|previewData)\b/,
      decreaseIndentPattern: /^\s*@end(section|type|block|layout|each|if|previewData)\b/,
    },
    onEnterRules: [
      {
        beforeText: /^\s*@(section|type|block|layout|each|if|previewData)\b.*$/,
        afterText: /^\s*@end(section|type|block|layout|each|if|previewData)\b/,
        action: { indentAction: monaco.languages.IndentAction.IndentOutdent },
      },
      {
        beforeText: /^\s*@(section|type|block|layout|each|if|previewData)\b.*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
      ...(htmlConfiguration.onEnterRules || []),
    ],
  });
  monaco.languages.setMonarchTokensProvider(languageId, languageForDialect(descriptor));
  }
}
