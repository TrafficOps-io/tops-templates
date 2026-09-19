# @trafficops/template-editor-monaco

Monaco adapters for `@trafficops/template-language`. The host must supply a
schema-1 dialect descriptor to `modelLanguage(path, descriptor)` and a
`getDialect(model)` callback to IntelliSense and formatting registration.
`safe-html-v1` and `fast-landings-v1` have separate model languages and grammars.
Unknown or absent descriptors select plain text and return no TPL assistance.
Template source never selects or upgrades the dialect.

Import `./setup` explicitly in a Vite browser entry to install Monaco workers.
The main entry contains no browser-global setup. Providers can be registered
once per Monaco instance; callbacks and caches can be replaced by re-registering.
Dispose registrations when the embedding application closes, not on a file change.
Use distinct URI authorities for independent editor projects.
