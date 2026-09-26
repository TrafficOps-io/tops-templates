# TrafficOps template language

The host selects `safe-html-v1` or `fast-landings-v1` when calling `parseDocument` and `buildProject`. Template source cannot select a dialect. The package also exposes completion, hover, definitions, signatures, symbols and runtime macro analysis.

```js
const language = require('@trafficops/template-language');
const { formatDocument } = require('@trafficops/template-language/formatter');
const document = language.parseDocument('index.tpl', source, { dialect: 'safe-html-v1' });
```

The formatter preserves executable PHP spans and literal preview JSON. Both CommonJS consumers and ESM default imports are supported. A missing or unknown dialect identifier means `safe-html-v1` (`DEFAULT_DIALECT`, `normalizeDialect`); `parseDocument` and `buildProject` additionally report an unknown identifier as a diagnostic on each document, so a misconfigured host cannot silently gain PHP or request macros.
