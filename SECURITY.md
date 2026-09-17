# Security policy

Template DSL processes author-controlled source and values. Please treat parser, renderer, dialect, path, include, escaping and resource-limit defects as security-sensitive even when the impact depends on a host application.

## Supported versions

Before the first tagged release, only the current development revision receives security fixes. After releases begin, the latest `0.x` minor line is supported. Older `0.x` lines may receive a fix only when maintainers explicitly announce it.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, pull request, discussion, template fixture or test case.

Use the private vulnerability-reporting or security-advisory facility of the repository from which this package is distributed. Include:

- the affected package version or commit;
- the selected dialect and whether template authors are trusted;
- a minimal source, definition, values and runtime context needed to reproduce it;
- the observed impact and the host controls that were enabled;
- any suggested fix, if known.

If no private reporting control is visible, ask a maintainer for a private contact without publishing exploit details. Maintainers will acknowledge the report privately, investigate it, coordinate a fix and disclosure, and credit the reporter unless anonymity is requested. Timelines depend on impact and release coordination; no fixed response-time guarantee is made.

## Security scope

Examples of in-scope issues include:

- bypassing dialect path or source restrictions;
- executing PHP, Blade or another server-side language through `safe-html-v1`;
- escaping failures for settings or safe runtime tokens;
- runtime tokens reading undeclared request data, headers, secrets or services;
- include traversal or invoking a resolver with an unsafe name;
- resource-limit bypasses that cause disproportionate CPU or memory use;
- values becoming newly interpreted DSL, runtime or validation source;
- cross-page or partial metadata confusion at a dialect boundary.

The following are host-application responsibilities unless the package violates a documented guarantee:

- complete HTML and CSS sanitization;
- CSP, frame, navigation and browser isolation policy;
- archive extraction, asset ownership and media processing;
- authorization of include contents and publication actions;
- choosing whether authors may use a trusted executable dialect;
- executing, sandboxing or deploying output produced by such a dialect.

Read [the threat model](docs/threat-model.md) for the complete boundary.
