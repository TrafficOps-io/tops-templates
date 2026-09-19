# TrafficOps template language

The host selects `safe-html-v1` or `fast-landings-v1` when calling `parseDocument` and `buildProject`. Template source cannot select a dialect. The package also exposes completion, hover, definitions, signatures, symbols and runtime macro analysis.

```js
const language = require('@trafficops/template-language');
const { formatDocument } = require('@trafficops/template-language/formatter');
const document = language.parseDocument('index.tpl', source, { dialect: 'safe-html-v1' });
```

The formatter preserves executable PHP spans and literal preview JSON. Both CommonJS consumers and ESM default imports are supported. Consumers must validate unknown dialect identifiers before calling the analyzer: the legacy core normalizer falls back to the Fast Landings profile.
