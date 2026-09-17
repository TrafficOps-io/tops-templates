# Threat model

This model covers the `trafficops/template-dsl` parser, normalized definitions, value validation, renderer and dialect boundary. It does not claim that a host application, browser preview, archive importer or generated website is safe merely because it uses this package.

## Security goals

For the default `safe-html-v1` dialect, the package aims to:

- parse source and definitions without executing author content;
- reject PHP, Blade-like server execution and request-validation source;
- keep file and output names bounded safe relative paths;
- validate typed settings before rendering;
- escape scalar settings and sanitize supported rich-text fields;
- expose only explicit bounded runtime maps with placement-aware escaping;
- prevent settings and runtime values from becoming new template syntax;
- terminate predictably under bounded input, expansion and output work;
- make a more permissive dialect an explicit host privilege decision.

These guarantees assume the host uses the same intended dialect for import, validation and rendering and does not bypass validation with hand-mutated definitions.

## Assets to protect

- application process integrity and secrets;
- host filesystem, network and service-container access;
- tenant separation and include/source ownership;
- correctness of stored template definitions and settings;
- visitors from script injection, malicious navigation and form actions;
- service availability during parsing, validation, preview and rendering;
- the boundary between untrusted safe templates and trusted executable templates.

## Actors and trust levels

- **Template author:** potentially untrusted under `safe-html-v1`; explicitly trusted by a host before an executable dialect is selected.
- **Settings editor:** may control field values but not source, definitions, runtime context or dialect selection.
- **Host application:** trusted to choose the dialect, resolve authorized includes, apply document and asset policy, and publish output.
- **Runtime-context producer:** trusted only to supply the explicitly documented scalar keys, not markup or template source.
- **Visitor:** controls ordinary HTTP request data; the safe dialect does not read a request implicitly.

## Trust boundaries

### Source and includes

The parser receives text and a source name. It never opens that name itself. Include names are validated before an application callback is invoked, but the callback decides which content belongs to the template. It must constrain the source root, handle symlinks and archive entries safely, enforce aggregate upload quotas and avoid network fetches unless a separate trusted policy permits them.

### Definition and settings

`validateDefinition()` normalizes accepted structure. Call it again at a trust boundary even for a previously stored definition. `validateValues()` applies field types, nesting, counts, sizes and URL policy. In the common engine and safe dialect, settings are data: they are not rescanned for directives, Mustache expressions or safe-runtime tokens. A trusted application-owned post-render runtime may explicitly define a different rule and must document that additional interpretation boundary.

### Dialect

The host chooses the dialect in code or trusted configuration. A dialect can preserve syntax that common code cannot inspect, so it is part of the trusted computing base. Template metadata, file extension or source content must not trigger automatic escalation to a permissive dialect.

### Output

Value escaping is not whole-document sanitization. Static author markup can still contain elements, attributes, CSS and outbound URLs that a particular product should not publish. The host must validate the complete composed document after rendering and before storage or publication.

## Principal threats and controls

| Threat | Package control | Host obligation |
| --- | --- | --- |
| PHP/Blade execution in safe templates | Safe dialect rejects executable paths and source patterns; package never evaluates source | Do not route untrusted content to an executable dialect or PHP handler |
| Path traversal | Relative-path checks reject absolute, dotted, hidden and encoded/control-bearing segments | Resolve includes/assets below an authorized root and handle symlinks/archive entries |
| Stored/reflected HTML injection through settings | Scalar output is escaped; rich text is rendered through the bounded sanitizer | Apply a final document-level element, attribute, CSS and URL allowlist |
| Runtime-token context breakout | Safe tokens are placement checked and encoded; action URLs have whole-attribute rules | Supply only intended keys and reapply CSP/navigation/form policy |
| Template-language injection through values | Values are single pass and never retokenized | Do not manually concatenate values into source before validation |
| Server-side request data exposure | Safe runtime accepts explicit maps only; no headers/body/wildcards | Construct maps by allowlist and avoid secrets or sensitive identifiers |
| Include confusion | Cycles, depth and names are bounded before callback | Authorize returned bytes and maintain template/tenant ownership |
| Resource exhaustion | Byte, line, field, page, partial, nesting, expansion, operation and output caps | Add request timeouts, upload/archive quotas, concurrency controls and lower service limits |
| Dialect downgrade/escalation | Default is safe; source cannot select a dialect | Bind policy explicitly, include dialect ID in caches and revalidate on policy changes |
| Executable trusted output | Not provided by safe dialect | Trusted dialect owner must isolate compilation/execution, deployment and author access |

## Safe runtime details

`safe-html-v1` accepts only `query`, `locale` and `actions` supplied directly to render calls. It bounds map sizes, identifiers and scalar byte length. Query and locale values in URL attributes require an author-controlled fixed prefix and are URL encoded. Action values must be HTTPS or safe absolute local paths and fill a complete quoted action attribute.

The runtime checks both initial source placement and composed output placement. This matters because partials and sections can otherwise move a token across an HTML boundary. Runtime values are escaped and are not inspected for further tokens.

## Trusted executable dialects

An executable dialect changes the threat model substantially. For example, the documented application-owned `fast-landings-v1` profile preserves PHP and request-runtime declarations. The common parser still enforces its definition and work budgets, but it cannot prove arbitrary protected code safe.

The Fast Landings integration keeps PHP opaque behind collision-checked marker prefixes during common parsing and rendering. Its layout-boundary scan is PHP-token-aware: directive-looking lines inside PHP strings, heredocs and comments stay opaque, while a genuine standalone layout boundary remains visible, including the final boundary after a deliberately open PHP block.

Request-validation declarations are composed after rendering from the main page and each actually used partial once; unused partials contribute nothing. Validation-looking lines introduced through rendered values are escaped as data, PHP is restored and the complete composed source is validated again. This catches duplicate or conflicting declarations across fragments and rechecks runtime-macro placement after composition. The application post-render scan covers author source and rendered setting values once; HTML-escaped request values inserted by the generated runtime are not scanned again.

A host selecting such a dialect must, at minimum:

- restrict authoring and import to principals authorized to deploy code;
- keep untrusted safe templates on a separate policy path;
- review and scan executable source and dependencies;
- compile and execute in an appropriately isolated runtime with least privilege;
- control filesystem, environment, network, secrets, sessions and outbound requests;
- define request validation, CSRF, upload and response-header behavior;
- account for whether stored setting values may declare deferred runtime tokens;
- make generated executable file ownership and deployment atomic and auditable.

`LiteralRuntimeStrategy` is preservation, not sanitization. It must not be presented as safe evaluation of the preserved syntax.

## Explicit non-goals

The package does not:

- extract or validate ZIP/TAR archives;
- fetch preview URLs or remote includes;
- authorize template, asset or tenant ownership;
- provide a complete HTML/CSS/URL sanitizer for authored documents;
- generate CSP or browser sandbox policy;
- scan media, proxy remote assets or enforce media licenses;
- provide request CSRF, rate limiting or publication authorization;
- sandbox PHP or any application-owned runtime;
- guarantee that application-registered field types or dialects preserve this model.

## Deployment checklist

1. Use `SafeTemplateDialect` unless authors are explicitly trusted to deploy executable content.
2. Validate source paths, parsed definitions and values at each external trust boundary.
3. Resolve includes and assets from an application-owned manifest, not arbitrary paths.
4. Apply final-document markup/CSS/URL policy after composition.
5. Enforce CSP, navigation, frame, form and preview isolation appropriate to the product.
6. Set service-level byte, time and concurrency limits below package hard caps where practical.
7. Key caches and stored policy decisions by language version and dialect ID.
8. Run package and dialect integration tests when either side changes.
9. Follow [SECURITY.md](../SECURITY.md) for suspected bypasses.
